import { db, admin, logger, COLLECTIONS } from '../firebase.js';

/**
 * Attempts to acquire an exclusive lock for a user.
 * Locks auto-expire after 5 minutes.
 * 
 * @param {string} discordId - The user's Discord ID
 * @param {string} ownerId - The requestId/interactionId that owns this lock attempt
 */
export async function tryLock(discordId, ownerId = null) {
    const lockRef = db.collection(COLLECTIONS.LOCKS).doc(discordId);
    try {
        await db.runTransaction(async (t) => {
            const lockSnap = await t.get(lockRef);
            if (lockSnap.exists) {
                const data = lockSnap.data();
                
                // IDEMPOTENCY: If the current owner is the same as requested, allow it (re-entry)
                if (ownerId && data.ownerId === ownerId) {
                    return;
                }

                // HARDENING: Gracefully handle malformed or partial lock documents
                if (data && data.expiresAt) {
                    const expiresAtDate = typeof data.expiresAt.toDate === 'function' 
                        ? data.expiresAt.toDate() 
                        : new Date(data.expiresAt);
                        
                    if (expiresAtDate > new Date()) {
                        throw new Error('ALREADY_LOCKED');
                    }
                }
            }
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 5);
            t.set(lockRef, { 
                ownerId,
                expiresAt, 
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        return true;
    } catch (e) {
        if (e.message === 'ALREADY_LOCKED') return false;
        throw e;
    }
}

/**
 * Extends an existing lock by another 5 minutes.
 */
export async function renewLock(discordId) {
    const lockRef = db.collection(COLLECTIONS.LOCKS).doc(discordId);
    try {
        await db.runTransaction(async (t) => {
            const lockSnap = await t.get(lockRef);
            if (!lockSnap.exists) throw new Error('LOCK_NOT_FOUND');
            
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 5);
            
            t.update(lockRef, { 
                expiresAt, 
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        return true;
    } catch (e) {
        logger.warn(`Failed to renew lock for ${discordId}`, { error: e.message });
        return false;
    }
}

/**
 * Explicitly releases a user's generation lock.
 */
export async function releaseLock(discordId) {
    try {
        await db.collection(COLLECTIONS.LOCKS).doc(discordId).delete();
    } catch (err) {
        logger.error(`Failed to release lock for ${discordId}`, err);
    }
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
