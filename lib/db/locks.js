import { db, admin, logger, COLLECTIONS } from '../firebase.js';

/**
 * Attempts to acquire an exclusive lock for a user.
 * Locks auto-expire after 5 minutes.
 */
export async function tryLock(discordId) {
    const lockRef = db.collection(COLLECTIONS.LOCKS).doc(discordId);
    try {
        await db.runTransaction(async (t) => {
            const lockSnap = await t.get(lockRef);
            if (lockSnap.exists) {
                const data = lockSnap.data();
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
 */
export async function releaseLock(discordId) {
    await db.collection(COLLECTIONS.LOCKS).doc(discordId).delete();
}

/**
 * Cleans up any locks that have expired. 
 */
export async function cleanupStaleLocks() {
    try {
        const now = new Date();
        const staleSnap = await db.collection(COLLECTIONS.LOCKS).where('expiresAt', '<', now).limit(500).get();
        if (staleSnap.empty) return 0;

        const batch = db.batch();
        staleSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        const deletedCount = staleSnap.size;
        if (deletedCount === 500) {
            return deletedCount + await cleanupStaleLocks();
        }
        return deletedCount;
    } catch (err) {
        logger.error("Failed to cleanup stale locks", err);
        return 0;
    }
}
