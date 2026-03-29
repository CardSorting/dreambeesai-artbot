import admin from 'firebase-admin';
import { applicationDefault } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';
import { Logger } from '../core/Logger.js';
import { UserProfile, Transaction } from '../models/index.js';

const logger = new Logger();

/**
 * Financial Precision Utilities for Zaps (Internal Currency)
 * Standardizes to 2 decimal places across the entire Hive.
 */
function toZapPrecision(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function formatZaps(amount: number): string {
    return toZapPrecision(amount).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

export const COLLECTIONS = {
    USERS: 'artbot_users',
    TRANSACTIONS: 'artbot_transactions',
    IMAGES: 'images',
    GENERATION_QUEUE: 'generation_queue',
    GUILDS: 'artbot_guilds',
    SYSTEM: 'artbot_system',
    LOCKS: 'artbot_locks',
    COOLDOWNS: 'artbot_cooldowns',
    STUDIOS: 'artbot_studios',
    GENERATIONS: 'artbot_generations',
    HEALTH: '_health'
};

export const MODELS = Object.freeze({
    'wai-illustrious': { id: 'wai-illustrious', name: 'Dream HQ', costPerImage: 1, description: 'High-quality art' },
    'zit-h100-v1': { id: 'zit-h100-v1', name: 'Dream Flash', costPerImage: 0.5, description: 'Instant art' }
});

export const COSTS = Object.freeze({
    DREAM: 4,
    FLASH: 2,
    REMIX: 0.50,
    MOCKUP: 0.50,
    PRISM: 1.50,
    GACHA: 0.25,
    GRID: 1.00,
    VARIATION: 1.50,
    MATCH: 0.50
});

/**
 * MONOLITHIC PILLAR: HivePersistence
 * Consolidates all database, wallet, and state-persistence logic.
 */
export class HivePersistence {
    private adminApp: admin.app.App | null = null;
    public db!: admin.firestore.Firestore;
    public admin = admin;

    constructor() {
        this.initialize();
    }

    private initialize() {
        process.env.GOOGLE_CLOUD_FIRESTORE_TELEMETRY_DISABLED = 'true';
        // (Config will be injected or accessed via process.env during the Pass 2 refactor)
        const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(process.cwd(), './serviceAccountKey.json');
        const projectId = process.env.GCLOUD_PROJECT || 'dreambees-alchemist';

        try {
            let credential;
            if (saJson) {
                credential = admin.credential.cert(JSON.parse(saJson));
            } else if (fs.existsSync(saPath)) {
                credential = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
            } else {
                credential = applicationDefault();
            }

            if (!admin.apps.length) {
                this.adminApp = admin.initializeApp({ credential, projectId });
            } else {
                this.adminApp = admin.app();
            }
            this.db = admin.firestore();
            this.db.settings({ ignoreUndefinedProperties: true });
            logger.info(`[HivePersistence] Connected to Firestore (Project: ${projectId})`);
        } catch (err: any) {
            logger.error("[HivePersistence] Initialization failed", err);
            throw err;
        }
    }

    // --- Connectivity & Maintenance ---
    async verifyConnectivity(): Promise<boolean> {
        try {
            await this.db.collection(COLLECTIONS.HEALTH).doc('connectivity_probe').set({
                lastChecked: admin.firestore.FieldValue.serverTimestamp(),
                v: '3.1.0-monolithic',
                node: process.env.HOSTNAME || 'hive-node'
            });
            return true;
        } catch (err) {
            return false;
        }
    }

    // --- Pricing Logic (Consolidated from lib/models.js) ---
    calculateBatchCost(modelId: string, count = 4): number {
        const model = (MODELS as any)[modelId] || MODELS['wai-illustrious'];
        return (model.costPerImage || 0) * Math.min(Math.max(0, count), 4);
    }

    // --- User Operations (Consolidated from users.js) ---
    async getOrCreateUser(discordId: string, discordTag?: string, photoURL?: string | null): Promise<UserProfile> {
        const userRef = this.db.collection(COLLECTIONS.USERS).doc(discordId);
        return await this.db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            if (snap.exists) {
                const data = snap.data() as UserProfile;
                const updates: any = { lastActive: admin.firestore.FieldValue.serverTimestamp() };
                if (discordTag && data.discordTag !== discordTag) updates.discordTag = discordTag;
                if (photoURL && data.photoURL !== photoURL) updates.photoURL = photoURL;
                t.update(userRef, updates);
                return { ...data, ...updates };
            }
            const newUser: Omit<UserProfile, 'uid'> = {
                discordId, discordTag, photoURL: photoURL || null,
                zaps: 100, joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastActive: admin.firestore.FieldValue.serverTimestamp(),
                _type: 'discord_native'
            };
            t.set(userRef, newUser);
            return { uid: discordId, ...newUser } as UserProfile;
        });
    }

    // --- Wallet Operations (Consolidated from WalletService) ---
    async debit(discordId: string, amount: number, txId: string, metadata: any = {}): Promise<{ success: boolean; error?: string }> {
        const userRef = this.db.collection(COLLECTIONS.USERS).doc(discordId);
        const txRef = this.db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
        const cleanAmount = toZapPrecision(amount);

        try {
            return await this.db.runTransaction(async (t) => {
                const [userSnap, txSnap] = await Promise.all([t.get(userRef), t.get(txRef)]);
                if (txSnap.exists) return { success: true };
                if (!userSnap.exists) return { success: false, error: 'User profile not found' };

                const userData = userSnap.data() as UserProfile;
                if (userData.zaps < cleanAmount) return { success: false, error: 'Insufficient Zaps' };

                t.update(userRef, { zaps: admin.firestore.FieldValue.increment(-cleanAmount) });
                t.set(txRef, {
                    userId: discordId, amount: -cleanAmount, type: 'DEBIT',
                    status: 'pending', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    ...metadata
                });
                return { success: true };
            });
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    // --- Format & Utilities ---
    format(amount: number): string {
        return formatZaps(amount);
    }

    precision(amount: number): number {
        return toZapPrecision(amount);
    }

    async refund(txId: string, reason: string): Promise<boolean> {
        const txRef = this.db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
        try {
            return await this.db.runTransaction(async (t) => {
                const txSnap = await t.get(txRef);
                if (!txSnap.exists) return false;
                const txData = txSnap.data() as Transaction;
                if (txData.status === 'refunded') return true;

                const userRef = this.db.collection(COLLECTIONS.USERS).doc(txData.userId);
                const refundAmount = Math.abs(txData.amount);
                t.update(userRef, { zaps: admin.firestore.FieldValue.increment(refundAmount) });
                t.update(txRef, { status: 'refunded', refundReason: reason, refundedAt: admin.firestore.FieldValue.serverTimestamp() });
                return true;
            });
        } catch (err) {
            return false;
        }
    }

    // --- Lock Operations (Consolidated from locks.js) ---
    async tryLock(discordId: string, ownerId?: string): Promise<boolean> {
        const lockRef = this.db.collection(COLLECTIONS.LOCKS).doc(discordId);
        try {
            await this.db.runTransaction(async (t) => {
                const snap = await t.get(lockRef);
                if (snap.exists) {
                    const data = snap.data();
                    if (ownerId && data?.ownerId === ownerId) return;
                    if (data?.expiresAt?.toDate() > new Date()) throw new Error('ALREADY_LOCKED');
                }
                const expiresAt = new Date();
                expiresAt.setMinutes(expiresAt.getMinutes() + 5);
                t.set(lockRef, { ownerId, expiresAt, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            });
            return true;
        } catch (e: any) {
            return e.message === 'ALREADY_LOCKED' ? false : true;
        }
    }

    async releaseLock(discordId: string) {
        await this.db.collection(COLLECTIONS.LOCKS).doc(discordId).delete().catch(() => {});
    }

    // --- Thread Operations (Consolidated from threads.js) ---
    async getStudioThreadId(discordId: string, channelId: string): Promise<string | null> {
        const doc = await this.db.collection(COLLECTIONS.STUDIOS).doc(`${discordId}_${channelId}`).get();
        return doc.exists ? doc.data()?.threadId : null;
    }

    async setStudioThreadId(discordId: string, channelId: string, threadId: string) {
        await this.db.collection(COLLECTIONS.STUDIOS).doc(`${discordId}_${channelId}`).set({
            discordId, channelId, threadId, updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // --- Cooldowns (Consolidated from lib/db/cooldowns.js) ---
    async setCooldown(discordId: string, durationMs: number) {
        const expiresAt = new Date(Date.now() + durationMs);
        await this.db.collection(COLLECTIONS.COOLDOWNS).doc(discordId).set({
            expiresAt, updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    async getRemainingCooldown(discordId: string): Promise<number> {
        const snap = await this.db.collection(COLLECTIONS.COOLDOWNS).doc(discordId).get();
        if (!snap.exists) return 0;
        const expiresAt = snap.data()?.expiresAt?.toDate()?.getTime() || 0;
        return Math.max(0, expiresAt - Date.now());
    }

    // --- Daily Claims (Consolidated from lib/wallet.js) ---
    async claimDaily(discordId: string, options: { guildId: string }): Promise<{ 
        success: boolean, rewardAmount: number, bonusAmount: number, newStreak: number, newBalance: number 
    }> {
        const userRef = this.db.collection(COLLECTIONS.USERS).doc(discordId);
        const { available, nextReset } = await this.isDailyRewardAvailable(discordId);
        if (!available) throw new Error(`You have already claimed your honey today! Next harvest: <t:${Math.floor(nextReset / 1000)}:R>`);

        return await this.db.runTransaction(async (t) => {
            const userSnap = await t.get(userRef);
            if (!userSnap.exists) throw new Error('Hive resident not found');
            const userData = userSnap.data() as UserProfile;

            const BASE_REWARD = 100;
            const streak = (userData.claimStreak || 0) + 1;
            const bonus = Math.floor(streak / 5) * 50; // Every 5 days, +50 bonus
            const totalReward = BASE_REWARD + bonus;

            const now = new Date();
            const dateId = `claim_${now.getUTCFullYear()}_${now.getUTCMonth() + 1}_${now.getUTCDate()}`;

            t.update(userRef, { 
                zaps: admin.firestore.FieldValue.increment(totalReward),
                claimStreak: streak,
                lastFreeClaimAt: admin.firestore.FieldValue.serverTimestamp()
            });

            t.set(userRef.collection('claims').doc(dateId), {
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                reward: totalReward, bonus, streak, guildId: options.guildId
            });

            return { 
                success: true, 
                rewardAmount: BASE_REWARD, 
                bonusAmount: bonus, 
                newStreak: streak, 
                newBalance: (userData.zaps || 0) + totalReward 
            };
        });
    }

    // --- Claim Status (Consolidated from status.js) ---
    async isDailyRewardAvailable(discordId: string): Promise<{ available: boolean, nextReset: number }> {
        const now = new Date();
        const dateId = `claim_${now.getUTCFullYear()}_${now.getUTCMonth() + 1}_${now.getUTCDate()}`;
        const claimSnap = await this.db.collection(COLLECTIONS.USERS).doc(discordId).collection('claims').doc(dateId).get();
        
        const nextReset = new Date();
        nextReset.setUTCHours(24, 0, 0, 0);
        
        return {
            available: !claimSnap.exists,
            nextReset: nextReset.getTime()
        };
    }

    // --- Generation Records (Consolidated from lib/db/generations.js) ---
    async saveGeneration(interactionId: string, data: any) {
        await this.db.collection(COLLECTIONS.GENERATIONS).doc(interactionId).set({
            ...data,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    async getGeneration(interactionId: string): Promise<any> {
        const snap = await this.db.collection(COLLECTIONS.GENERATIONS).doc(interactionId).get();
        return snap.exists ? snap.data() : null;
    }

    // --- Recovery Operations (Consolidated from recovery.js) ---
    async recoverZombies(): Promise<number> {
        const STALE_THRESHOLD = 10 * 60 * 1000;
        const staleTime = new Date(Date.now() - STALE_THRESHOLD);
        const snap = await this.db.collection(COLLECTIONS.TRANSACTIONS)
            .where('status', '==', 'pending')
            .where('timestamp', '<', staleTime)
            .limit(50).get();

        if (snap.empty) return 0;
        let count = 0;
        for (const doc of snap.docs) {
            const finished = await this.db.collection(COLLECTIONS.GENERATIONS).doc(doc.id).get();
            if (finished.exists) {
                await doc.ref.update({ status: 'completed' });
            } else {
                await this.refund(doc.id, 'Zombie Recovery');
                count++;
            }
        }
        return count;
    }

    /**
     * PILLAR INTEGRATION: Moderation Logging
     * Moved from HiveSafety to centralize all DB writes in Persistence.
     */
    async logModerationEvent(data: {
        userId: string,
        userTag?: string,
        guildId?: string,
        originalPrompt: string,
        matchedTerm: string,
        action: string
    }) {
        const { userId, userTag, guildId, originalPrompt, matchedTerm, action } = data;
        
        return await this.db.runTransaction(async (t) => {
            const userRef = this.db.collection(COLLECTIONS.USERS).doc(userId);
            const userSnap = await t.get(userRef);
            
            let strikes = 0;
            let lastStrikeAt = 0;
            
            if (userSnap.exists) {
                const userData = userSnap.data() as UserProfile;
                strikes = userData.abuseStrikes || 0;
                lastStrikeAt = (userData as any).lastStrikeAt?.toDate()?.getTime() || 0;
            } else {
                // Initialize user if they don't exist yet
                const newUser: Omit<UserProfile, 'uid'> = {
                    discordId: userId, discordTag: userTag, photoURL: null,
                    zaps: 100, joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastActive: admin.firestore.FieldValue.serverTimestamp(),
                    _type: 'discord_native'
                };
                t.set(userRef, newUser);
            }

            let strikeWeight = 1;
            const now = Date.now();
            if (now - lastStrikeAt < 60000) strikeWeight = 2; // Rapid fire penalty

            const logRef = this.db.collection('moderation_logs').doc();
            t.set(logRef, {
                userId, userTag, guildId, originalPrompt, matchedTerm, strikeWeight, action,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            t.update(userRef, {
                abuseStrikes: admin.firestore.FieldValue.increment(strikeWeight),
                lastStrikeAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return strikeWeight;
        });
    }

    async close() {
        if (this.adminApp) await this.adminApp.delete();
    }
}

export const hivePersistence = new HivePersistence();
