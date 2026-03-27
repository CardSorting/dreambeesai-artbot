import admin from 'firebase-admin';
import { applicationDefault } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

// Assuming serviceAccountKey is located in the root 'DreamBeesv11' folder
// Replaces manual serviceAccountKey loading with a more flexible production-ready approach
let credential;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        credential = admin.credential.cert(sa);
    } catch (e) {
        logger.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON", e);
        credential = applicationDefault();
    }
} else {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(process.cwd(), '../serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        credential = admin.credential.cert(serviceAccount);
    } else {
        credential = applicationDefault();
    }
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential,
        projectId: process.env.GCLOUD_PROJECT
    });
}

export { admin };
export const db = admin.firestore();

const guildConfigCache = new Map();

/**
 * Fetches the configuration for a specific guild with a 5-minute TTL cache.
 * @param {string} guildId - The Discord guild ID.
 * @returns {Promise<Object>} The guild configuration or defaults.
 */
export async function getGuildConfig(guildId) {
    if (!guildId) return { reportThreshold: 3 };

    const cached = guildConfigCache.get(guildId);
    if (cached && (Date.now() - cached.timestamp < 300000)) {
        return cached.data;
    }

    try {
        const doc = await db.collection('discord_guilds').doc(guildId).get();
        const data = doc.exists ? doc.data() : { reportThreshold: 3 };
        
        guildConfigCache.set(guildId, {
            data,
            timestamp: Date.now()
        });
        
        return data;
    } catch (err) {
        logger.error(`Failed to fetch guild config for ${guildId}`, err);
        return { reportThreshold: 3 };
    }
}

/**
 * Updates the configuration for a specific guild.
 * @param {string} guildId - The Discord guild ID.
 * @param {Object} config - The new configuration data.
 */
export async function setGuildConfig(guildId, config) {
    await db.collection('discord_guilds').doc(guildId).set(config, { merge: true });
    guildConfigCache.delete(guildId);
}

let remoteConfigCache = null;
let lastConfigFetch = 0;

/**
 * Fetches dynamic configuration from Firestore with a 5-minute TTL cache.
 */
export async function getRemoteConfig() {
    const now = Date.now();
    if (remoteConfigCache && (now - lastConfigFetch < 300000)) {
        return remoteConfigCache;
    }

    try {
        const doc = await db.collection('system').doc('config').get();
        if (doc.exists) {
            remoteConfigCache = doc.data();
            lastConfigFetch = now;
            return remoteConfigCache;
        }
    } catch (err) {
        logger.error("Failed to fetch remote config", err);
    }
    
    return {}; // Return empty if failed/missing
}

/**
 * Fetches the DreamBees user profile linked to a Discord ID.
 * @param {string} discordId
 */
export async function getUserByDiscordId(discordId) {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('discordId', '==', discordId).limit(1).get();
    
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { uid: doc.id, ...doc.data() };
}

/**
 * Saves a generation's metadata to Firestore.
 */
export async function saveGeneration(interactionId, data) {
    await db.collection('discord_generations').doc(interactionId).set({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Recovers "Zombie" transactions (Pending transactions that never finished).
 */
export async function recoverZombieTransactions() {
    const STALE_THRESHOLD_MINS = 30;
    const now = new Date();
    const staleTime = new Date(now.getTime() - STALE_THRESHOLD_MINS * 60 * 1000);

    const staleSnap = await db.collection('wallet_transactions')
        .where('status', '==', 'pending')
        .where('timestamp', '<', staleTime)
        .limit(50)
        .get();

    if (staleSnap.empty) return 0;

    logger.info(`Found ${staleSnap.size} zombie transactions. Attempting recovery...`);
    
    let recoveredCount = 0;
    for (const doc of staleSnap.docs) {
        const tx = doc.data();
        try {
            // Check if generation record exists (maybe it finished but status update failed?)
            const genDoc = await db.collection('discord_generations').doc(doc.id).get();
            if (genDoc.exists) {
                // It actually finished! Just update the status.
                await db.collection('wallet_transactions').doc(doc.id).update({
                    status: 'completed',
                    recoveredAt: admin.firestore.FieldValue.serverTimestamp()
                });
                logger.info(`Zombie ${doc.id} marked as completed (generation exists).`);
                continue;
            }

            // No generation found. Issuing refund.
            const { Wallet } = await import('./wallet.js'); // Lazy import to avoid circular dependency
            const refundId = `${doc.id}_zombie_refund`;
            
            await Wallet.credit(tx.userId, tx.amount, refundId, {
                reason: 'Zombie Recovery',
                originalTxId: doc.id,
                source: 'system'
            });

            await db.collection('wallet_transactions').doc(doc.id).update({
                status: 'refunded',
                recoveredAt: admin.firestore.FieldValue.serverTimestamp()
            });

            logger.info(`Zombie ${doc.id} successfully refunded.`);
            recoveredCount++;
        } catch (err) {
            logger.error(`Failed to recover zombie transaction ${doc.id}`, err);
        }
    }

    return recoveredCount;
}

/**
 * Retrieves generation metadata from Firestore.
 * @param {string} interactionId - The interaction ID to look up.
 * @returns {Promise<Object|null>}
 */
export async function getGeneration(interactionId) {
    const doc = await db.collection('discord_generations').doc(interactionId).get();
    return doc.exists ? doc.data() : null;
}

/**
 * Attempts to acquire an exclusive lock for a user.
 * Locks auto-expire after 5 minutes.
 * @param {string} discordId - The user's Discord ID.
 * @returns {Promise<boolean>} True if lock acquired, false if already locked.
 */
export async function tryLock(discordId) {
    const lockRef = db.collection('discord_locks').doc(discordId);
    try {
        await db.runTransaction(async (t) => {
            const lockSnap = await t.get(lockRef);
            if (lockSnap.exists) {
                const data = lockSnap.data();
                // Auto-expire lock after 5 minutes in case of crash
                if (data.expiresAt.toDate() > new Date()) {
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
    await db.collection('discord_locks').doc(discordId).delete();
}

/**
 * Cleans up any locks that have expired. 
 * Can be called periodically or on bot startup.
 */
export async function cleanupStaleLocks() {
    try {
        const now = new Date();
        const staleSnap = await db.collection('discord_locks').where('expiresAt', '<', now).limit(500).get();
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
        logger.error("Failed to cleanup stale locks", err);
        return 0;
    }
}

/**
 * Checks if a user is on cooldown. Returns remaining ms or 0.
 */
export async function getRemainingCooldown(userId) {
    const doc = await db.collection('discord_cooldowns').doc(userId).get();
    if (!doc.exists) return 0;
    const data = doc.data();
    const remaining = data.endsAt.toDate() - new Date();
    return remaining > 0 ? remaining : 0;
}

/**
 * Sets a cooldown for a user.
 */
export async function setCooldown(userId, durationMs) {
    const endsAt = new Date(Date.now() + durationMs);
    await db.collection('discord_cooldowns').doc(userId).set({
        endsAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

/**
 * Adds a report for a generation and returns the new report count.
 * @param {string} interactionId - The interaction ID being reported.
 * @param {Object} reportData - Metadata about the reporter.
 * @returns {Promise<number>} The total number of reports for this interaction.
 */
export async function addReport(interactionId, reportData) {
    const reportRef = db.collection('reported_generations').doc(interactionId);
    return await db.runTransaction(async (t) => {
        const snap = await t.get(reportRef);
        let count = 1;
        let reporters = [reportData.reportedBy];

        if (snap.exists) {
            const data = snap.data();
            if (data.reporters && data.reporters.includes(reportData.reportedBy)) {
                return data.count || 0; // User already reported
            }
            count = (data.count || 0) + 1;
            reporters = [...(data.reporters || []), reportData.reportedBy];
        }

        t.set(reportRef, {
            ...reportData,
            count,
            reporters,
            lastReportedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return count;
    });
}

