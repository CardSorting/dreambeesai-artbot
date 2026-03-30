import admin from 'firebase-admin';
import { applicationDefault } from 'firebase-admin/app';
// Web SDK Imports (Fallback)
import { initializeApp as initializeWebApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { 
    getFirestore as getWebFirestore, 
    doc as webDoc, 
    getDoc as webGetDoc, 
    setDoc as webSetDoc, 
    updateDoc as webUpdateDoc, 
    deleteDoc as webDeleteDoc, 
    collection as webCollection, 
    query as webQuery, 
    where as webWhere, 
    limit as webLimit, 
    orderBy as webOrderBy, 
    getDocs as webGetDocs, 
    runTransaction as webRunTransaction, 
    increment as webIncrement, 
    serverTimestamp as webServerTimestamp,
    Timestamp as WebTimestamp
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { HiveConfig } from '../core/HiveConfig.js';
/**
 * PILLAR MODEL: UserProfile
 */
export interface UserProfile {
    uid: string;
    discordId: string;
    discordTag?: string;
    photoURL?: string | null;
    zaps: number;
    joinedAt: any; // Firestore Timestamp
    lastActive: any; // Firestore Timestamp
    lastTransactionTime?: any;
    claimStreak?: number;
    lastFreeClaimAt?: any;
    abuseStrikes?: number;
    lastStrikeAt?: any;
    _type?: string;
}

/**
 * PILLAR MODEL: Transaction
 */
export interface Transaction {
    id?: string;
    userId: string;
    type: 'DEBIT' | 'CREDIT' | 'debit' | 'credit';
    amount: number;
    currency?: string;
    previousBalance?: number;
    newBalance?: number;
    requestId?: string;
    status: 'pending' | 'processing' | 'completed' | 'refunded' | 'failed';
    source?: string;
    metadata?: any;
    timestamp: any; // Firestore Timestamp
    createdAt?: string;
    refundedAt?: any;
    refundReason?: string;
    originalTxId?: string;
}

/**
 * PILLAR UTILITY: Internalized Logger
 */
export class Logger {
    constructor(private ctx: any = {}) {}
    private log(level: string, message: string, data: any = {}) {
        const payload = { timestamp: new Date().toISOString(), level, message, ...this.ctx, ...data };
        if (process.env.NODE_ENV === 'production') process.stdout.write(JSON.stringify(payload) + '\n');
        else process.stdout.write(`[${level}] ${message} ${Object.keys(data).length ? JSON.stringify(data) : ''}\n`);
    }
    info(m: string, d?: any) { this.log('INFO', m, d); }
    warn(m: string, d?: any) { this.log('WARN', m, d); }
    error(m: string, d?: any) { this.log('ERROR', m, d); }
    debug(m: string, d?: any) { this.log('DEBUG', m, d); }
}

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
    private webApp: any = null;
    public db!: any; // Set to either Admin or Web Firestore
    public admin = admin;
    private isWebSDK = false;
    private memoryCache = new Map<string, { data: any, expires: number }>();

    public initPromise: Promise<void> | null = null;

    constructor() {
        this.initPromise = this.initialize();
    }

    private async ensureReady() {
        if (this.initPromise) {
            await this.initPromise;
        }
    }

    // --- SDK Compatibility Shim ---
    public doc(path: string, ...pathSegments: string[]) {
        if (this.isWebSDK) return webDoc(this.db, path, ...pathSegments);
        return this.db.doc(`${path}/${pathSegments.join('/')}`);
    }


    public collection(path: string) {
        if (!this.isWebSDK) return this.db.collection(path);
        
        const col = webCollection(this.db, path);
        return {
            doc: (id?: string) => id ? webDoc(this.db, path, id) : webDoc(webCollection(this.db, path)),
            where: (field: string, op: any, value: any) => {
                const q = webQuery(col, webWhere(field, op, value));
                return {
                    limit: (n: number) => ({
                        get: () => webGetDocs(webQuery(q, webLimit(n)))
                    }),
                    get: () => webGetDocs(q)
                };
            },
            orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => {
                const q = webQuery(col, webOrderBy(field, dir));
                return {
                    limit: (n: number) => ({
                        get: () => webGetDocs(webQuery(q, webLimit(n)))
                    }),
                    get: () => webGetDocs(q)
                };
            },
            limit: (n: number) => ({
                get: () => webGetDocs(webQuery(col, webLimit(n)))
            }),

            get: () => webGetDocs(col),
            add: (data: any) => webSetDoc(webDoc(col), data)
        };
    }

    public async runTransactionCompat<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
        if (this.isWebSDK) {
            return await webRunTransaction(this.db, async (webT) => {
                const shimT = {
                    get: async (ref: any) => {
                        const snap = await webT.get(ref);
                        return { 
                            exists: snap.exists(), 
                            data: () => snap.data(), 
                            id: snap.id, 
                            ref 
                        };
                    },
                    set: (ref: any, data: any, options?: any) => webT.set(ref, data, options),
                    update: (ref: any, data: any) => webT.update(ref, data),
                    delete: (ref: any) => webT.delete(ref)
                };
                return await updateFunction(shimT);
            });
        }
        return await this.db.runTransaction(updateFunction);
    }

    public get fieldValue() {
        return this.isWebSDK ? { serverTimestamp: webServerTimestamp, increment: webIncrement } : admin.firestore.FieldValue;
    }

    public async getDocCompat(ref: any) {
        if (this.isWebSDK) {
            const snap = await webGetDoc(ref);
            return { exists: snap.exists(), data: () => snap.data(), id: snap.id, ref };
        }
        return await ref.get();
    }

    public async setDocCompat(ref: any, data: any, options: any = {}) {
        if (!this.isWebSDK) return await ref.set(data, options);
        return await webSetDoc(ref, data, options);
    }

    public async updateDocCompat(ref: any, data: any) {
        if (this.isWebSDK) return await webUpdateDoc(ref, data);
        return await ref.update(data);
    }

    // --- Cache Logic ---
    private getCached<T>(key: string): T | null {
        const item = this.memoryCache.get(key);
        if (!item) return null;
        if (Date.now() > item.expires) {
            this.memoryCache.delete(key);
            return null;
        }
        return item.data as T;
    }

    private setCached(key: string, data: any, ttlMs = 300000) {
        this.memoryCache.set(key, { data, expires: Date.now() + ttlMs });
    }

    /**
     * WARM CACHE PRIMING
     * Automatically pre-loads the top 50 most active users into memory on boot.
     */
    async primeWarmCache() {
        await this.ensureReady();
        try {
            const snap = await this.collection(COLLECTIONS.USERS)
                .orderBy('lastActive', 'desc')
                .limit(50).get();
            
            for (const doc of snap.docs) {
                this.setCached(`user_${doc.id}`, { uid: doc.id, ...doc.data() });
            }
            logger.info(`[HivePersistence] Warm cache primed with ${snap.size} residents.`);
        } catch (err) {
            logger.warn(`[HivePersistence] Cache priming skipped: ${err}`);
        }
    }

    private async initialize() {
        process.env.GOOGLE_CLOUD_FIRESTORE_TELEMETRY_DISABLED = 'true';
        const saJson = HiveConfig.FIREBASE_SERVICE_ACCOUNT_JSON;
        const saPath = path.resolve(process.cwd(), './serviceAccountKey.json');
        const projectId = process.env.GCLOUD_PROJECT || 'dreambees-alchemist';

        // Check for Web SDK / Admin User fallback (Option 4)
        const webApiKey = HiveConfig.FIREBASE_API_KEY;
        const webEmail = HiveConfig.FIREBASE_AUTH_EMAIL;
        const webPass = HiveConfig.FIREBASE_AUTH_PASSWORD;

        try {
            // Priority 1: Service Account Key
            if (saJson || fs.existsSync(saPath)) {
                let credential;
                if (saJson) {
                    credential = admin.credential.cert(JSON.parse(saJson));
                } else {
                    credential = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
                }
                this.adminApp = admin.initializeApp({ credential, projectId });
                this.db = admin.firestore();
                logger.info(`[HivePersistence] Connected via Service Account (Project: ${projectId})`);
            } 
            // Priority 2: Web SDK Admin User (Fallback)
            else if (webApiKey && webEmail && webPass) {
                this.isWebSDK = true;
                this.webApp = initializeWebApp({
                    apiKey: webApiKey,
                    authDomain: HiveConfig.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
                    projectId: projectId
                });
                
                const auth = getAuth(this.webApp);
                await signInWithEmailAndPassword(auth, webEmail, webPass);
                this.db = getWebFirestore(this.webApp);
                logger.info(`[HivePersistence] Connected via Admin User: ${webEmail}`);
            }
            // Priority 3: Application Default Credentials
            else {
                this.adminApp = admin.initializeApp({ credential: applicationDefault(), projectId });
                this.db = admin.firestore();
                logger.info(`[HivePersistence] Connected via Application Default Credentials (Project: ${projectId})`);
            }

            if (!this.isWebSDK) {
                this.db.settings({ ignoreUndefinedProperties: true });
            }

        } catch (err: any) {
            logger.error("[HivePersistence] Initialization failed", err);
            throw err;
        }
    }

    // --- Connectivity & Maintenance ---
    async verifyConnectivity(): Promise<boolean> {
        await this.ensureReady();
        try {
            const ref = this.collection(COLLECTIONS.HEALTH).doc('connectivity_probe');
            await this.setDocCompat(ref, {
                lastChecked: this.fieldValue.serverTimestamp(),
                v: '3.1.0-monolithic',
                node: process.env.HOSTNAME || 'hive-node'
            });
            return true;
        } catch (err: any) {
            logger.error(`[HivePersistence] Connectivity check failed`, { error: err.message });
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
        await this.ensureReady();
        const cached = this.getCached<UserProfile>(`user_${discordId}`);
        if (cached) return cached;

        const userRef = this.collection(COLLECTIONS.USERS).doc(discordId);
        const user = await this.runTransactionCompat(async (t) => {
            const snap = await t.get(userRef);
            if (snap.exists) {
                const data = snap.data() as UserProfile;
                const updates: any = { lastActive: this.fieldValue.serverTimestamp() };
                if (discordTag && data.discordTag !== discordTag) updates.discordTag = discordTag;
                if (photoURL && data.photoURL !== photoURL) updates.photoURL = photoURL;
                t.update(userRef, updates);
                return { ...data, ...updates };
            }
            const newUser: Omit<UserProfile, 'uid'> = {
                discordId, discordTag, photoURL: photoURL || null,
                zaps: 100, joinedAt: this.fieldValue.serverTimestamp(),
                lastActive: this.fieldValue.serverTimestamp(),
                _type: 'discord_native'
            };
            t.set(userRef, newUser);
            return { uid: discordId, ...newUser } as UserProfile;
        });

        this.setCached(`user_${discordId}`, user);
        return user;
    }

    // --- Wallet Operations (Consolidated from WalletService) ---
    async debit(discordId: string, amount: number, txId: string, metadata: any = {}): Promise<{ success: boolean; error?: string }> {
        await this.ensureReady();
        const userRef = this.collection(COLLECTIONS.USERS).doc(discordId);
        const txRef = this.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
        const cleanAmount = toZapPrecision(amount);

        try {
            return await this.runTransactionCompat(async (t) => {
                const [userSnap, txSnap] = await Promise.all([t.get(userRef), t.get(txRef)]);
                if (txSnap.exists) return { success: true };
                if (!userSnap.exists) return { success: false, error: 'User profile not found' };

                const userData = userSnap.data() as UserProfile;
                if (userData.zaps < cleanAmount) return { success: false, error: 'Insufficient Zaps' };

                t.update(userRef, { zaps: this.fieldValue.increment(-cleanAmount) });
                t.set(txRef, {
                    userId: discordId, 
                    amount: -cleanAmount, 
                    type: 'DEBIT',
                    status: 'pending', 
                    timestamp: this.fieldValue.serverTimestamp(),
                    vector: {
                        missionId: txId,
                        category: metadata.category || 'unknown',
                        prompt: metadata.prompt || 'hidden'
                    },
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
        await this.ensureReady();
        const txRef = this.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
        try {
            return await this.runTransactionCompat(async (t) => {
                const txSnap = await t.get(txRef);
                if (!txSnap.exists) return false;
                const txData = txSnap.data() as Transaction;
                if (txData.status === 'refunded') return true;

                const userRef = this.collection(COLLECTIONS.USERS).doc(txData.userId);
                const refundAmount = Math.abs(txData.amount);
                t.update(userRef, { zaps: this.fieldValue.increment(refundAmount) });
                t.update(txRef, { status: 'refunded', refundReason: reason, refundedAt: this.fieldValue.serverTimestamp() });
                return true;
            });
        } catch (err) {
            return false;
        }
    }

    // --- Lock Operations (Consolidated from locks.js) ---
    async tryLock(discordId: string, ownerId?: string): Promise<boolean> {
        await this.ensureReady();
        const lockRef = this.collection(COLLECTIONS.LOCKS).doc(discordId);
        try {
            await this.runTransactionCompat(async (t) => {
                const snap = await t.get(lockRef);
                if (snap.exists) {
                    const data = snap.data();
                    // If ownerId matches, we allow re-entrancy, but we must update the expiry
                    if (ownerId && data?.ownerId === ownerId) {
                        const expiresAt = new Date();
                        expiresAt.setMinutes(expiresAt.getMinutes() + 5);
                        t.update(lockRef, { expiresAt });
                        return;
                    }
                    if (data?.expiresAt?.toDate?.() > new Date()) throw new Error('ALREADY_LOCKED');
                }
                const expiresAt = new Date();
                expiresAt.setMinutes(expiresAt.getMinutes() + 5);
                t.set(lockRef, { ownerId, expiresAt, createdAt: this.fieldValue.serverTimestamp() });
            });
            return true;
        } catch (e: any) {
            // Strictly fail-closed: return false on any error, including network or ALREADY_LOCKED
            if (e.message !== 'ALREADY_LOCKED') {
                logger.error(`[LOCK] Failed to acquire lock for ${discordId} due to unexpected error:`, e.message);
            }
            return false;
        }
    }

    async releaseLock(discordId: string) {
        await this.ensureReady();
        if (this.isWebSDK) {
            await webDeleteDoc(this.doc(COLLECTIONS.LOCKS, discordId));
        } else {
            await this.db.collection(COLLECTIONS.LOCKS).doc(discordId).delete().catch(() => {});
        }
    }

    // --- Thread Operations (Consolidated from threads.js) ---
    async getStudioThreadId(discordId: string, channelId: string): Promise<string | null> {
        await this.ensureReady();
        const ref = this.collection(COLLECTIONS.STUDIOS).doc(`${discordId}_${channelId}`);
        const doc = await this.getDocCompat(ref);
        return doc.exists ? doc.data()?.threadId : null;
    }

    async setStudioThreadId(discordId: string, channelId: string, threadId: string) {
        await this.ensureReady();
        const ref = this.collection(COLLECTIONS.STUDIOS).doc(`${discordId}_${channelId}`);
        await this.setDocCompat(ref, {
            discordId, channelId, threadId, updatedAt: this.fieldValue.serverTimestamp()
        });
    }

    // --- Cooldowns (Consolidated from lib/db/cooldowns.js) ---
    async setCooldown(discordId: string, durationMs: number) {
        await this.ensureReady();
        const expiresAt = new Date(Date.now() + durationMs);
        const ref = this.collection(COLLECTIONS.COOLDOWNS).doc(discordId);
        await this.setDocCompat(ref, {
            expiresAt, updatedAt: this.fieldValue.serverTimestamp()
        });
    }

    async getRemainingCooldown(discordId: string): Promise<number> {
        await this.ensureReady();
        const ref = this.collection(COLLECTIONS.COOLDOWNS).doc(discordId);
        const snap = await this.getDocCompat(ref);
        if (!snap.exists) return 0;
        const expiresAt = snap.data()?.expiresAt?.toDate()?.getTime() || 0;
        return Math.max(0, expiresAt - Date.now());
    }

    // --- Daily Claims (Consolidated from lib/wallet.js) ---
    async claimDaily(discordId: string, options: { guildId: string }): Promise<{ 
        success: boolean, rewardAmount: number, bonusAmount: number, newStreak: number, newBalance: number 
    }> {
        await this.ensureReady();
        const userRef = this.doc(COLLECTIONS.USERS, discordId);
        const { available, nextReset } = await this.isDailyRewardAvailable(discordId);
        if (!available) {
            const nextTime = `<t:${Math.floor(nextReset / 1000)}:R>`;
            throw new Error(`ALREADY_CLAIMED: You have already gathered your honey today! Next harvest: ${nextTime}`);
        }

        return await this.runTransactionCompat(async (t) => {
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
                zaps: this.fieldValue.increment(totalReward),
                claimStreak: streak,
                lastFreeClaimAt: this.fieldValue.serverTimestamp()
            });

            const claimRef = this.doc(COLLECTIONS.USERS, discordId, 'claims', dateId);

            t.set(claimRef, {
                timestamp: this.fieldValue.serverTimestamp(),
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
        await this.ensureReady();
        const now = new Date();
        const dateId = `claim_${now.getUTCFullYear()}_${now.getUTCMonth() + 1}_${now.getUTCDate()}`;
        
        const claimRef = this.doc(COLLECTIONS.USERS, discordId, 'claims', dateId);
            
        const claimSnap = await this.getDocCompat(claimRef);
        
        const nextReset = new Date();
        nextReset.setUTCHours(24, 0, 0, 0);
        
        return {
            available: !claimSnap.exists,
            nextReset: nextReset.getTime()
        };
    }

    // --- Generation Records (Consolidated from lib/db/generations.js) ---
    async saveGeneration(interactionId: string, data: any) {
        await this.ensureReady();
        const ref = this.collection(COLLECTIONS.GENERATIONS).doc(interactionId);
        await this.setDocCompat(ref, {
            status: 'queued',
            ...data,
            timestamp: this.fieldValue.serverTimestamp()
        });
    }

    /**
     * ATOMIC TASK CLAIMING
     * Ensures only one worker instance can process a specific interaction task.
     * Implements mission idempotency for asynchronous workers.
     */
    async claimTask(interactionId: string): Promise<{ success: boolean; reason?: string }> {
        await this.ensureReady();
        const ref = this.collection(COLLECTIONS.GENERATIONS).doc(interactionId);
        const txRef = this.collection(COLLECTIONS.TRANSACTIONS).doc(interactionId);

        try {
            return await this.runAtomic(async (t) => {
                const [snap, txSnap] = await Promise.all([t.get(ref), t.get(txRef)]);
                const exists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
                
                if (exists) {
                    const data = typeof snap.data === 'function' ? snap.data() : snap.data;
                    if (data && (data.status === 'processing' || data.status === 'completed')) {
                        return { success: false, reason: 'ALREADY_PROCESSED' };
                    }
                }

                // Mark as processing
                t.set(ref, {
                    status: 'processing',
                    startedAt: this.fieldValue.serverTimestamp()
                }, { merge: true });

                // Update transaction status if it exists
                if (txSnap.exists) {
                    t.update(txRef, { status: 'processing' });
                }

                return { success: true };
            });
        } catch (err: any) {
            logger.error(`[HivePersistence] Failed to claim task ${interactionId}`, err);
            return { success: false, reason: err.message };
        }
    }

    async getGeneration(interactionId: string): Promise<any> {
        await this.ensureReady();
        const ref = this.collection(COLLECTIONS.GENERATIONS).doc(interactionId);
        const snap = await this.getDocCompat(ref);
        return snap.exists ? snap.data() : null;
    }

    // --- Recovery Operations (Consolidated from recovery.js) ---
    async recoverZombies(): Promise<number> {
        await this.ensureReady();
        const STALE_THRESHOLD = 5 * 60 * 1000; // Lowered to 5 mins for production
        const staleTime = new Date(Date.now() - STALE_THRESHOLD);
        
        logger.info(`[HivePersistence] Sweeping for zombies older than ${staleTime.toISOString()}`);
        
        const snap = await this.collection(COLLECTIONS.TRANSACTIONS)
            .where('status', '==', 'pending')
            .limit(50).get();

        if (snap.empty) return 0;
        let count = 0;
        for (const doc of snap.docs) {
            const data = doc.data();
            const ts = data.timestamp?.toDate?.() || new Date(0);
            if (ts > staleTime) continue;

            const genRef = this.collection(COLLECTIONS.GENERATIONS).doc(doc.id);
            const finished = await this.getDocCompat(genRef);
            
            if (finished.exists && finished.data().status === 'completed') {
                await this.updateDocCompat(doc.ref, { status: 'completed' });
            } else {
                logger.warn(`[RECOVERY] Refunding zombie mission: ${doc.id}`);
                await this.refund(doc.id, 'Zombie Recovery (Auto-Sweep)');
                count++;
            }
        }
        return count;
    }

    /**
     * PILLAR RESILIENCE: Atomic Wrapper
     * Ensures multi-document mutations are wrapped in a single transaction.
     */
    async runAtomic<T>(op: (t: any) => Promise<T>): Promise<T> {
        await this.ensureReady();
        return await this.runTransactionCompat(op);
    }

    /**
     * PILLAR INTEGRATION: Moderation Logging (Pass 3)
     * Centralizes strike calculation and behavioral tracking.
     */
    async logModerationEvent(data: {
        userId: string,
        userTag?: string,
        guildId?: string,
        originalPrompt: string,
        matchedTerm: string,
        action: string,
        strikeWeight?: number
    }) {
        await this.ensureReady();
        const { userId, userTag, guildId, originalPrompt, matchedTerm, action, strikeWeight = 1 } = data;
        
        return await this.runAtomic(async (t) => {
            const userRef = this.collection(COLLECTIONS.USERS).doc(userId);
            const userSnap = await t.get(userRef);
            
            if (!userSnap.exists) {
                const newUser: Omit<UserProfile, 'uid'> = {
                    discordId: userId, discordTag: userTag, photoURL: null,
                    zaps: 100, joinedAt: this.fieldValue.serverTimestamp(),
                    lastActive: this.fieldValue.serverTimestamp(),
                    _type: 'discord_native'
                };
                t.set(userRef, newUser);
            }

            const logRef = this.collection('moderation_logs').doc();
            t.set(logRef, {
                ...data,
                strikeWeight,
                timestamp: this.fieldValue.serverTimestamp()
            });

            t.update(userRef, {
                abuseStrikes: this.fieldValue.increment(strikeWeight),
                lastStrikeAt: this.fieldValue.serverTimestamp()
            });

            return strikeWeight;
        });
    }

    async close() {
        if (this.adminApp) await this.adminApp.delete();
    }
}

export const hivePersistence = new HivePersistence();
