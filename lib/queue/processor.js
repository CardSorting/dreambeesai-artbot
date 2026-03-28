import { generateSingleImage, registerDiscordGrid } from '../api/dreambees.js';
import { stitchImages, validateImageBuffer } from '../image-processor.js';
import { uploadToS3 } from '../s3.js';
import { saveGeneration } from '../db/generations.js';
import { logger } from '../logger.js';
import { Wallet } from '../wallet.js';
import pLimit from 'p-limit';
import { admin, COLLECTIONS, db } from '../firebase.js';
import { calculateBatchCost } from '../models.js';

/**
 * Standard S3 Upload with Retry Logic
 */
async function uploadToS3WithRetry(filename, buffer, retries = 3, options = {}) {
    if (options.signal?.aborted) throw new Error("Upload aborted by signal before start");
    try {
        return await uploadToS3(filename, buffer);
    } catch (err) {
        if (options.signal?.aborted) throw new Error("Upload aborted by signal during retry wait");
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 1000 * (4 - retries)));
            return uploadToS3WithRetry(filename, buffer, retries - 1, options);
        }
        throw err;
    }
}

/**
 * Executes a generation task from the queue.
 */
export async function processGenerationTask(payload, options = {}) {
    const { 
        requestId, prompt, modelId, userId, discordId, guildId, 
        targetDisplayName, targetPhotoURL, batchSize = 4 
    } = payload;
    const { logger: ctxLogger = logger, signal } = options;

    ctxLogger.info(`[QueueProcessor] Processing task ${requestId}`, { userId, prompt });

    // IDEMPOTENCY CHECK: Skip if already completed or failed
    const queueRef = db.collection(COLLECTIONS.GENERATION_QUEUE).doc(requestId);
    const snap = await queueRef.get();
    if (snap.exists) {
        const currentStatus = snap.data().status;
        if (currentStatus === 'completed') {
            ctxLogger.info(`[QueueProcessor] Task ${requestId} already marked completed. Skipping.`);
            return snap.data();
        }
    }

    try {
        // 1. Concurrent Image Generation
        // HARDENING: Increase concurrency to 4 to ensure faster completion within Cloud Run / Cloud Tasks timeout (60-90s).
        const limit = pLimit(4);
        const tasks = Array.from({ length: batchSize }).map((_, i) => limit(async () => {
            // IMAGE-LEVEL IDEMPOTENCY: In a retry scenario, we don't want to re-generate images that already exist.
            // For now, we'll just log and proceed, but in a real-world high-cost scenario, we'd check S3 existence here.
            
            const result = await generateSingleImage(prompt, modelId, userId, { 
                logger: ctxLogger, 
                signal, 
                requestId: `${requestId}_${i}` 
            });
            const s3Filename = `generations/${requestId}_${i}.webp`;
            const s3Url = await uploadToS3WithRetry(s3Filename, result.buffer, 3, { signal });
            return { url: s3Url, imageId: result.imageId, buffer: result.buffer };
        }));

        const resultsRaw = await Promise.allSettled(tasks);
        const results = resultsRaw.filter(r => r.status === 'fulfilled').map(r => r.value);
        const failures = resultsRaw.filter(r => r.status === 'rejected').map(r => r.reason);

        if (results.length === 0) {
            throw new Error(`All generation tasks failed: ${failures[0]?.message || 'Unknown error'}`);
        }

        if (failures.length > 0) {
            ctxLogger.warn(`Partial batch failure: ${failures.length}/${batchSize} tasks failed`, { failures: failures.map(f => f.message) });
        }

        const buffers = results.map(r => r.buffer);
        const s3Urls = results.map(r => r.url);
        const imageIds = results.map(r => r.imageId);

        // 2. Validation & Stitching
        await Promise.all(buffers.map((buf, i) => validateImageBuffer(buf, `Image ${i+1}`)));
        const gridBuffer = await stitchImages(buffers, { logger: ctxLogger, signal });
        
        if (signal?.aborted) throw new Error("Processing aborted by signal during stitching");

        // 3. Grid Storage & Registration
        const gridFilename = `discord-grids/${requestId}.webp`;
        const gridUrl = await uploadToS3WithRetry(gridFilename, gridBuffer, 3, { signal });
        
        await registerDiscordGrid(gridUrl, prompt, modelId, userId, {
            displayName: targetDisplayName,
            photoURL: targetPhotoURL,
            requestId: requestId
        }).catch(err => ctxLogger.error("Grid Sync Failed", err));

        // PRODUCTION HARDENING: Explicit cost resolution
        const finalCost = payload.cost || calculateBatchCost(modelId, batchSize);
        const completedAt = admin.firestore.FieldValue.serverTimestamp();

        // ROUND TRIP REDUCTION: Batch all final updates
        const batch = db.batch();
        
        // 1. Generation Record
        const genRef = db.collection('artbot_generations').doc(requestId);
        batch.set(genRef, {
            prompt, modelId, userId: discordId, dreambeesUid: userId,
            guildId, urls: s3Urls, imageIds, gridUrl, cost: finalCost, 
            status: 'completed', createdAt: completedAt
        });

        // 2. Transaction Status
        const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(requestId);
        batch.update(txRef, {
            status: 'completed',
            updatedAt: completedAt,
            lastStatusUpdateAt: completedAt
        });

        // 3. Queue Status (The processor now owns the final status update)
        batch.update(queueRef, {
            status: 'completed',
            gridUrl,
            imageIds,
            imageUrls: s3Urls,
            updatedAt: completedAt,
            completedAt
        });

        await batch.commit();
        ctxLogger.info(`[QueueProcessor] Consolidated final updates for ${requestId}`);

        return {
            status: 'completed',
            gridUrl,
            imageIds,
            imageUrls: s3Urls,
            completedAt,
            _alreadyUpdated: true // Flag for index.js to skip redundant update
        };

    } catch (error) {
        ctxLogger.error(`[QueueProcessor] Task failed: ${requestId}`, error);
        
        const finalCost = payload.cost || calculateBatchCost(modelId, batchSize);
        if (finalCost > 0) {
            ctxLogger.info(`[QueueProcessor] Suggesting refund for failed task ${requestId}`);
            await Wallet.refund(requestId, `Generation Failure: ${error.message}`).catch(err => 
                ctxLogger.error("CRITICAL: Automatic refund failed during task failure", err)
            );
        }

        return {
            status: 'failed',
            error: error.message,
            failedAt: admin.firestore.FieldValue.serverTimestamp()
        };
    }
}
