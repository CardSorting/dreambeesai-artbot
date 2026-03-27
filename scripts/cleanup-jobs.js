import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Searches for 'processing' jobs that have been stuck for over 15 minutes.
 * These are likely crashed or interrupted generations.
 */
export async function cleanupZombieJobs() {
    const fifteenMinutesAgo = new Date();
    fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);

    logger.info("Starting Zombie Job Cleanup scan...");

    try {
        const stuckSnap = await db.collection('generation_queue')
            .where('status', 'in', ['processing', 'queued'])
            // We use server timestamp if available, but manual createdAt is safer fallback
            .where('createdAt', '<', fifteenMinutesAgo)
            .get();

        if (stuckSnap.empty) {
            logger.info("No zombie jobs found.");
            return 0;
        }

        logger.warn(`Found ${stuckSnap.size} zombie jobs. Marking as failed...`);

        const batch = db.batch();
        stuckSnap.docs.forEach(doc => {
            batch.update(doc.ref, {
                status: 'failed',
                error: 'Generation timeout or system interruption (Zombie Cleaned)',
                updatedAt: new Date()
            });
        });

        await batch.commit();
        logger.info(`Successfully cleaned ${stuckSnap.size} zombie jobs.`);
        return stuckSnap.size;
    } catch (err) {
        logger.error("Error during zombie job cleanup", err);
        throw err;
    }
}

// If run standalone
if (process.argv[1].includes('cleanup-jobs.js')) {
    cleanupZombieJobs().then(() => process.exit(0)).catch(() => process.exit(1));
}
