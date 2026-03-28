import { db, admin, logger } from '../firebase.js';

/**
 * Attempts to acquire an exclusive lock for a user.
 * Locks auto-expire after 5 minutes.
 * @param {string} discordId - The user's Discord ID.
 * @returns {Promise<boolean>} True if lock acquired, false if already locked.
 */
export async function tryLock(discordId) {
    const lockRef = db.collection('artbot_locks').doc(discordId);
    try {
        await db.runTransaction(async (t) => {
            const lockSnap = await t.get(lockRef);
            if (lockSnap.exists) {
                const data = lockSnap.data();
                // Auto-expire lock after 5 minutes in case of crash
                const expiresAtDate = data.expiresAt?.toDate?.() || data.expiresAt;
                if (expiresAtDate && expiresAtDate > new Date()) {
                    throw new Error('ALREADY_LOCKED');
                }
            }
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 5);
            t.set(lockRef, { expiresAt, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        });
        return true;
    } catch (e) {
        if (e.message === 'ALREADY_LOCKED') return false;
        throw e;
    }
}

/**
 * Explicitly releases a user's generation lock.
 * @param {string} discordId - The user's Discord ID.
 */
export async function releaseLock(discordId) {
    await db.collection('artbot_locks').doc(discordId).delete();
}

/**
 * Cleans up any locks that have expired. 
 * Can be called periodically or on bot startup.
 */
export async function cleanupStaleLocks() {
    try {
        const now = new Date();
        const staleSnap = await db.collection('artbot_locks').where('expiresAt', '<', now).limit(500).get();
        if (staleSnap.empty) return 0;

        const batch = db.batch();
        staleSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        const deletedCount = staleSnap.size;
        // If we hit the limit, there might be more to clean up
        if (deletedCount === 500) {
            return deletedCount + await cleanupStaleLocks();
        }
        return deletedCount;
    } catch (err) {
        if (err.message.includes("invalid_grant") || err.message.includes("reauth")) {
            logger.error("\n[CRITICAL] Firebase Auth Error: Your local 'gcloud' credentials have expired.");
            logger.error(">>> RESOLUTION: Please run 'gcloud auth application-default login' in your terminal.\n");
        } else if (err.code === 'permission-denied' || err.message.includes('permission')) {
            logger.warn("[WARNING] Firestore Permission Denied for 'artbot_locks'.");
            logger.warn(">>> RESOLUTION: Please ensure your Firestore Security Rules allow read/write to 'artbot_locks'.");
        } else {
            logger.error("Failed to cleanup stale locks", err);
        }
        return 0;
    }
}
