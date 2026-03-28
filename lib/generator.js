import { saveGeneration } from './db/generations.js';
import { tryLock, releaseLock } from './db/locks.js';
import { getRemainingCooldown, setCooldown } from './db/cooldowns.js';
import { getUserByDiscordId, getOrCreateDiscordUser } from './db/users.js';
import { uploadToS3 } from './s3.js';
import { logger } from './logger.js';
import { Wallet } from './wallet.js';
import { MODELS, calculateBatchCost } from './models.js';
import pLimit from 'p-limit';

import { recordGenerationMetrics } from './metrics.js';
import { generateSingleImage, registerDiscordGrid, isCircuitOpen } from './api/dreambees.js';
import { stitchImages, validateImageBuffer } from './image-processor.js';
import { AttachmentBuilder } from 'discord.js';
import { 
    createGenerationEmbed, 
    createUpscaleRow, 
    createModRow 
} from './discord-ux.js';
import { wrapInAegis } from './safety-utils.js';
import { refineNectar } from './hive.js';

const MAX_GLOBAL_CONCURRENT = 50;
let currentGlobalJobs = 0;

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
 * The main orchestrator for image generation.
 */
export async function performGeneration(interaction, discordUserId, prompt, modelId, options = {}) {
    const { logger: ctxLogger = logger } = options;
    const discordId = interaction.user.id;
    const interactionId = interaction.id;
    const startTime = Date.now();
    const { jobs } = options;
    
    // Create job-specific AbortController for shutdown/cancellation
    const controller = new AbortController();
    const { signal } = controller;
    
    // Register the job so it can be aborted by the global shutdown handler
    if (jobs) jobs.set(interactionId, controller);
    
    currentGlobalJobs++;

    try {
        // 1. Rate Limiting (Cooldown)
        const cooldownMs = await getRemainingCooldown(discordId);
        if (cooldownMs > 0) {
            const seconds = Math.ceil(cooldownMs / 1000);
            return interaction.editReply({ 
                content: `🐝 **Bzzzzt!** Don't overwork the swarm! Please wait **${seconds}s** before starting another generation.`, 
                ephemeral: true 
            });
        }

        // 2. Health & Capacity Checks
        if (isCircuitOpen()) {
            return interaction.editReply({ content: '🍯 **Restoring Nectar...** Honey-making vats are being refilled. Please wait a moment!', components: [] });
        }

        const lockAcquired = await tryLock(discordId);
        if (!lockAcquired) {
            return interaction.editReply({ content: '⏳ **Active Worker!** You already have a busy bee working on a generation for you!', ephemeral: true });
        }

        if (currentGlobalJobs >= MAX_GLOBAL_CONCURRENT) {
            return interaction.editReply({ content: '🔥 **Hive Swarmed!** Extreme system load. Please try again soon.', components: [] });
        }

        // 3. Final Wallet Check & Debit
        const totalCost = calculateBatchCost(modelId, 4);
        const userProfile = await getUserByDiscordId(discordId);
        if (!userProfile || (userProfile.zaps || 0) < totalCost) {
            throw new Error(`Insufficient Zaps. Need ${totalCost}, have ${(userProfile?.zaps || 0).toFixed(1)}`);
        }

        ctxLogger.info(`Debiting wallet for generation`, { totalCost });
        const debitResult = await Wallet.debit(userProfile.uid, totalCost, interactionId, { prompt, modelId });
        if (!debitResult.success) throw new Error('Wallet transaction failed.');
        zapsDebited = totalCost;

        const targetUserId = `discord:${discordId}`;
        const targetDisplayName = interaction.user.tag;
        const targetPhotoURL = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });
        ctxLogger.info(`Starting generation workflow`, { modelId, targetUserId });

        // 3. Concurrent Image Generation
        const limit = pLimit(2); 
        
        // Perimeter Check: Final Refinement & Aegis Wrap
        const refined = refineNectar(prompt);
        const safePrompt = wrapInAegis(refined);
        
        ctxLogger.info("Refining Nectar...", { original: prompt, refined });

        const tasks = Array.from({ length: 4 }).map((_, i) => limit(async () => {
            const result = await generateSingleImage(safePrompt, modelId, targetUserId, { logger: ctxLogger, signal });
            const s3Filename = `generations/${interactionId}_${i}.webp`;
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
            ctxLogger.warn(`Partial batch failure: ${failures.length}/4 tasks failed`, { failures: failures.map(f => f.message) });
        }
        const buffers = results.map(r => r.buffer);
        const s3Urls = results.map(r => r.url);
        const imageIds = results.map(r => r.imageId);

        // 4. Validation & Stitching
        await Promise.all(buffers.map((buf, i) => validateImageBuffer(buf, `Image ${i+1}`)));
        const gridBuffer = await stitchImages(buffers, { logger: ctxLogger, signal });
        if (signal?.aborted) return; // Silent exit if aborted during stitching

        // 5. Grid Storage & Registration (Sync to Web App)
        const gridFilename = `discord-grids/${interactionId}.webp`;
        const gridUrl = await uploadToS3WithRetry(gridFilename, gridBuffer, 3, { signal });
        
        // Push to Web App indexed by standardized Shadow ID
        await registerDiscordGrid(gridUrl, prompt, modelId, targetUserId, {
            displayName: targetDisplayName,
            photoURL: targetPhotoURL,
            requestId: interactionId
        })
            .catch(err => ctxLogger.error("Grid Sync Failed", err));

        // 6. Build Discord Response
        const embeds = [createGenerationEmbed(prompt, modelId)];

        // 7. Save to Local Persistence
        await saveGeneration(interactionId, {
            prompt, modelId, userId: discordId, dreambeesUid: targetUserId,
            guildId: interaction.guildId, urls: s3Urls, imageIds, gridUrl, cost: totalCost
        });

        // 8. Send Results
        await interaction.editReply({ 
            embeds: embeds, 
            files: [new AttachmentBuilder(gridBuffer, { name: 'generation.png' })],
            components: [createUpscaleRow(interactionId, imageIds), createModRow(interactionId)]
        });

        // 9. Update Transaction Status
        await Wallet.updateStatus(interactionId, 'completed');

        // 10. Post-Generation Cleanup & Metrics
        await setCooldown(discordId, 30000);
        
        const duration = Date.now() - startTime;
        ctxLogger.info(`Generation successful`, { duration });

        // Record Metrics
        recordGenerationMetrics({ modelId, duration, success: true });

    } catch (error) {
        ctxLogger.error('Generation orchestrator failure', error);

        // Attempt Refund
        if (zapsDebited > 0) {
            ctxLogger.info(`Attempting partial refund for failed generation`, { zapsDebited });
            await Wallet.refund(interactionId, `Generation Failure: ${error.message}`).catch(err => 
                ctxLogger.error("CRITICAL: Automatic refund failed during crash recovery", err)
            );
        }

        // Cleanup health metrics
        recordGenerationMetrics({ modelId, duration: Date.now() - startTime, success: false, error: error.message });

        // Rethrow for global handler
        throw error;
    } finally {
        currentGlobalJobs--;
        if (jobs) jobs.delete(interactionId);
        await releaseLock(discordId).catch(e => logger.error('Failed to release generation lock', e));
    }
}
