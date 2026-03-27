import admin from 'firebase-admin';
import { applicationDefault } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

// Assuming serviceAccountKey is located in the root 'DreamBeesv11' folder
// Replaces manual serviceAccountKey loading with a more flexible production-ready approach
let credential;
let db;
let adminInstance = admin;

// Check for Service Account Key (File or JSON String)
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(process.cwd(), './serviceAccountKey.json');

try {
    if (saJson) {
        credential = admin.credential.cert(JSON.parse(saJson));
    } else if (fs.existsSync(saPath)) {
        credential = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
    } else {
        // Fallback to Application Default Credentials (ADC)
        // Command: gcloud auth application-default login
        credential = applicationDefault();
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential,
            projectId: process.env.GCLOUD_PROJECT
        });
    }
    db = admin.firestore();
    logger.info("Firebase initialized via Admin SDK (Service Account or ADC).");
} catch (adminError) {
    logger.warn("Admin SDK initialization failed. Attempting Web SDK fallback...", adminError.message);

    // Fallback to Web SDK (Option 4)
    if (process.env.FIREBASE_API_KEY) {
        try {
            const { initializeApp } = await import('firebase/app');
            const { getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, limit, getDocs, runTransaction, writeBatch, serverTimestamp, FieldValue } = await import('firebase/firestore');
            const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');

            const firebaseConfig = {
                apiKey: process.env.FIREBASE_API_KEY,
                authDomain: process.env.FIREBASE_AUTH_DOMAIN,
                projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
                messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
                appId: process.env.FIREBASE_APP_ID
            };

            const app = initializeApp(firebaseConfig);
            const webDb = getFirestore(app);

            // Optional: Auth sign-in if credentials provided
            if (process.env.FIREBASE_AUTH_EMAIL && process.env.FIREBASE_AUTH_PASSWORD) {
                const auth = getAuth(app);
                await signInWithEmailAndPassword(auth, process.env.FIREBASE_AUTH_EMAIL, process.env.FIREBASE_AUTH_PASSWORD);
                logger.info("Firebase Web SDK authenticated as user:", process.env.FIREBASE_AUTH_EMAIL);
            }

            // Create a shim to mimic the Admin SDK API
            const shimDoc = (coll, id) => ({
                get: () => getDoc(doc(webDb, coll, id)).then(s => ({ exists: s.exists(), data: () => s.data(), id: s.id })),
                set: (data, opts) => setDoc(doc(webDb, coll, id), data, opts),
                update: (data) => updateDoc(doc(webDb, coll, id), data),
                delete: () => deleteDoc(doc(webDb, coll, id)),
                ref: doc(webDb, coll, id)
            });

            const shimCollection = (name) => ({
                doc: (id) => shimDoc(name, id),
                where: (f, o, v) => {
                    let q = query(collection(webDb, name), where(f, o, v));
                    return {
                        limit: (n) => { q = query(q, limit(n)); return { get: () => getDocs(q).then(s => ({ empty: s.empty, docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })), size: s.size })) }; },
                        get: () => getDocs(q).then(s => ({ empty: s.empty, docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })), size: s.size }))
                    };
                }
            });

            db = {
                collection: shimCollection,
                runTransaction: (callback) => runTransaction(webDb, async (t) => {
                    const webT = {
                        get: (refWrap) => t.get(refWrap.ref).then(s => ({ exists: s.exists(), data: () => s.data(), id: s.id })),
                        set: (refWrap, data, opts) => t.set(refWrap.ref, data, opts),
                        update: (refWrap, data) => t.update(refWrap.ref, data),
                        delete: (refWrap) => t.delete(refWrap.ref)
                    };
                    return callback(webT);
                }),
                batch: () => {
                    const b = writeBatch(webDb);
                    return {
                        set: (refWrap, data, opts) => b.set(refWrap.ref, data, opts),
                        update: (refWrap, data) => b.update(refWrap.ref, data),
                        delete: (refWrap) => b.delete(refWrap.ref),
                        commit: () => b.commit()
                    };
                }
            };

            // Shim for FieldValue/serverTimestamp
            adminInstance = {
                firestore: {
                    FieldValue: {
                        serverTimestamp: () => serverTimestamp()
                    }
                }
            };

            logger.info("Firebase initialized via Web SDK (Shim Mode).");
        } catch (webError) {
            logger.error("FATAL: All Firebase initialization methods failed.", webError);
            throw webError;
        }
    } else {
        logger.error("FATAL: No Firebase credentials provided (Service Account, ADC, or Web API Key).");
        throw adminError;
    }
}

export { adminInstance as admin, logger };
export { db };

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

/**
 * Retrieves the stored Art Studio thread ID for a user in a specific channel.
 * @param {string} discordId 
 * @param {string} channelId 
 * @returns {Promise<string|null>}
 */
export async function getStudioThreadId(discordId, channelId) {
    try {
        const doc = await db.collection('discord_studios').doc(`${discordId}_${channelId}`).get();
        return doc.exists ? doc.data().threadId : null;
    } catch (err) {
        logger.error("Failed to fetch studio thread ID", err);
        return null;
    }
}

/**
 * Saves the Art Studio thread ID for a user in a specific channel.
 * @param {string} discordId 
 * @param {string} channelId 
 * @param {string} threadId 
 */
export async function setStudioThreadId(discordId, channelId, threadId) {
    try {
        await db.collection('discord_studios').doc(`${discordId}_${channelId}`).set({
            discordId,
            channelId,
            threadId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        logger.error("Failed to save studio thread ID", err);
    }
}

