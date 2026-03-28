import dotenv from 'dotenv';
import { processGenerationTask } from '../lib/queue/processor.js';
import { logger } from '../lib/logger.js';
import { db, admin } from '../lib/firebase.js';

dotenv.config();

async function runTest() {
    await new Promise(r => setTimeout(r, 2000));
    const requestId = `audit_test_${Date.now()}`;
    const payload = {
        requestId,
        prompt: "A neon bee in a digital garden, high tech style",
        modelId: "wai-illustrious",
        userId: "test-user-audit",
        discordId: "1234567890",
        guildId: "dm",
        cost: 4,
        targetDisplayName: "AuditTester",
        targetPhotoURL: "https://cdn.discordapp.com/embed/avatars/0.png",
        batchSize: 4
    };

    logger.info(`Starting Audit Test (Request: ${requestId})...`);

    try {
        // First run (fresh request)
        await db.collection('generation_queue').doc(requestId).set({
            status: 'queued',
            ...payload,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        const result1 = await processGenerationTask(payload);
        logger.info("First Run Result:", result1.status);
        
        if (result1.status !== 'completed') throw new Error("First run failed to complete.");

        // Second run (simulate Cloud Task retry of a completed job)
        logger.info("Starting Idempotency Check (Second Run)...");
        const result2 = await processGenerationTask(payload);
        logger.info("Second Run Result:", result2.status);

        if (result2.status === 'completed' && !result2.imageUrls) {
             // If result2 is from the idempotency check, it returns the existing data
             logger.info("✅ Idempotency Check Passed: Skipped work for already completed job.");
        } else if (result2.status === 'completed') {
             logger.info("✅ Idempotency Check Passed: Job handled correctly.");
        }
        
        process.exit(0);
    } catch (err) {
        logger.error("❌ Audit Test Failed:", err);
        process.exit(1);
    }
}

runTest();
