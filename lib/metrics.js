import { db, admin } from './firebase.js';
import { logger } from './logger.js';

/**
 * Tracks generation success/failure and latency for analytics.
 */
export async function recordGenerationMetrics(data) {
    try {
        await db.collection('generation_metrics').add({
            ...data,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: new Date().toISOString()
        });
    } catch (err) {
        logger.error("Failed to record generation metrics", err);
    }
}
/**
 * Tracks daily reward claim success/failure.
 */
export async function recordClaimMetrics(data) {
    try {
        await db.collection('claim_metrics').add({
            ...data,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: new Date().toISOString()
        });
    } catch (err) {
        logger.error("Failed to record claim metrics", err);
    }
}
