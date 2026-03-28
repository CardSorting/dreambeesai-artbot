import { db, admin } from './firebase.js';
import { getRemoteConfig } from './db/config.js';
import { logger } from './logger.js';

export class Wallet {
    static async debit(uid, amount, requestId, metadata = {}, currency = 'zaps') {
        if (!uid) throw new Error('User must be authenticated.');
        if (!requestId) throw new Error('requestId is required for financial transactions.');
        if (amount < 0) throw new Error('Debit amount cannot be negative.');

        const userRef = db.collection('discord_users').doc(uid);
        const transactionRef = db.collection('wallet_transactions').doc(requestId);

        logger.info(`[Wallet] Initiating debit transaction: ${requestId}`, { uid, amount, currency });

        return await db.runTransaction(async (t) => {
            const existingTx = await t.get(transactionRef);
            if (existingTx.exists) {
                const data = existingTx.data();
                // If it exists, it means we already successfully processed this request (idempotency)
                // Return success if it's already 'completed' or 'pending'
                const isValidState = ['pending', 'completed'].includes(data.status);
                return { success: isValidState, idempotent: true, newBalance: data.newBalance, status: data.status };
            }

            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error('Discord User not found.');

            const userData = userDoc.data();
            const currentBalance = userData[currency] || 0; 

            if (amount > 0 && currentBalance < amount) {
                throw new Error(`Insufficient ${currency}. Need ${amount}, have ${currentBalance.toFixed(1)}`);
            }

            const newBalance = Math.round((currentBalance - amount) * 100) / 100;

            t.update(userRef, {
                [currency]: newBalance,
                lastTransactionTime: admin.firestore.FieldValue.serverTimestamp()
            });

            t.set(transactionRef, {
                userId: uid,
                type: 'debit',
                currency,
                amount,
                previousBalance: currentBalance,
                newBalance,
                requestId,
                status: 'pending',
                source: metadata.source || 'discord',
                metadata,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: new Date().toISOString()
            });

            return { success: true, transactionId: requestId, newBalance, idempotent: false, status: 'pending' };
        });
    }

    static async credit(uid, amount, requestId, metadata = {}, currency = 'zaps') {
        if (!uid || !requestId || amount < 0) throw new Error('Invalid arguments');

        const userRef = db.collection('discord_users').doc(uid);
        const transactionRef = db.collection('wallet_transactions').doc(requestId);

        return await db.runTransaction(async (t) => {
            const existingTx = await t.get(transactionRef);
            if (existingTx.exists) {
                return { success: true, idempotent: true };
            }

            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error('Discord User not found.');

            const userData = userDoc.data();
            const currentBalance = userData[currency] || 0;
            const newBalance = currentBalance + amount;

            t.update(userRef, {
                [currency]: newBalance,
                lastTransactionTime: admin.firestore.FieldValue.serverTimestamp()
            });

            t.set(transactionRef, {
                userId: uid, type: 'credit', currency, amount, previousBalance: currentBalance, newBalance, requestId, 
                status: 'completed', source: metadata.source || 'discord', metadata,
                timestamp: admin.firestore.FieldValue.serverTimestamp(), createdAt: new Date().toISOString()
            });

            return { success: true, transactionId: requestId, newBalance, idempotent: false };
        });
    }

    /**
     * Updates the status of an existing transaction (e.g., pending -> completed).
     */
    static async updateStatus(requestId, status) {
        if (!requestId || !status) return;
        const transactionRef = db.collection('wallet_transactions').doc(requestId);
        
        try {
            await db.runTransaction(async (t) => {
                const snap = await t.get(transactionRef);
                if (!snap.exists) throw new Error("Transaction not found");
                
                const currentStatus = snap.data().status;
                
                // Guard: Prevent overwriting terminal states
                const terminalStates = ['completed', 'refunded', 'failed'];
                if (terminalStates.includes(currentStatus) && status !== currentStatus) {
                    logger.warn(`Attempted invalid status transition for ${requestId}: ${currentStatus} -> ${status}`);
                    return;
                }

                t.update(transactionRef, {
                    status,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            logger.info(`Transaction ${requestId} updated to ${status}`);
        } catch (err) {
            logger.error(`Failed to update status for ${requestId}`, err);
        }
    }

    /**
     * Handles the daily credit claim for a Discord user.
     * Logic matches the DreamBeesv11 web app: 48h streak reset.
     * 
     * @param {string} uid - The Discord User ID.
     * @param {Object} context - Optional metadata like guildId or channelId.
     * @returns {Promise<Object>} Result of the claim.
     */
    static async claimDaily(uid, context = {}) {
        if (!uid) throw new Error('User ID is required.');

        const now = new Date();
        // Strict UTC date identification for cross-timezone consistency
        const dateId = `claim_${now.getUTCFullYear()}_${now.getUTCMonth() + 1}_${now.getUTCDate()}`;
        
        const userRef = db.collection('discord_users').doc(uid);
        const dailyClaimRef = userRef.collection('claims').doc(dateId);

        logger.info(`[Wallet] Processing daily claim attempt`, { uid, dateId, ...context });

        try {
            // Fetch Remote Config for dynamic rewards
            const config = await getRemoteConfig();
            const baseAmount = config.dailyRewardAmount || 100;
            const bonusPerDay = config.streakBonusAmount || 10;
            const maxBonus = config.maxStreakBonus || 100;

            return await db.runTransaction(async (transaction) => {
                // 1. Check if already claimed today (Atomic Check)
                const claimDoc = await transaction.get(dailyClaimRef);
                if (claimDoc.exists) {
                    throw new Error('ALREADY_CLAIMED');
                }

                // 2. Fetch User for Streak calculation (Atomic Read)
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists) throw new Error('Discord User not found.');

                const userData = userDoc.data();
                const lastClaim = userData.lastFreeClaimAt ? userData.lastFreeClaimAt.toDate() : new Date(0);
                
                // 48-hour window for streaks (generous reset)
                const resetMs = 48 * 60 * 60 * 1000;
                const timeSinceLastClaim = now.getTime() - lastClaim.getTime();
                const newStreak = timeSinceLastClaim <= resetMs ? (userData.claimStreak || 0) + 1 : 1;

                // 3. Dynamic Reward Calculation
                // Example: Day 5 streak gives 100 + min(5 * 10, 100) = 150 Zaps
                const bonusAmount = newStreak > 1 ? Math.min((newStreak - 1) * bonusPerDay, maxBonus) : 0;
                const totalReward = baseAmount + bonusAmount;
                const requestId = `claim_${uid}_${dateId}`;

                // 4. Mark daily claim record
                transaction.set(dailyClaimRef, {
                    claimedAt: admin.firestore.FieldValue.serverTimestamp(),
                    zapsAwarded: totalReward,
                    baseAmount,
                    bonusAmount,
                    streak: newStreak,
                    status: 'success',
                    ...context
                });

                // 5. Update User Balance & Streak
                const currentBalance = userData.zaps || 0;
                const newBalance = Math.round((currentBalance + totalReward) * 100) / 100;

                transaction.update(userRef, {
                    zaps: newBalance,
                    claimStreak: newStreak,
                    lastFreeClaimAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastTransactionTime: admin.firestore.FieldValue.serverTimestamp()
                });

                // 6. Log as a transaction for the ledger
                const transactionRef = db.collection('wallet_transactions').doc(requestId);
                transaction.set(transactionRef, {
                    userId: uid,
                    type: 'credit',
                    currency: 'zaps',
                    amount: totalReward,
                    previousBalance: currentBalance,
                    newBalance,
                    requestId,
                    status: 'completed',
                    source: 'daily_claim',
                    metadata: { 
                        streak: newStreak, 
                        baseAmount, 
                        bonusAmount,
                        ...context 
                    },
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: now.toISOString()
                });

                return { success: true, rewardAmount: totalReward, baseAmount, bonusAmount, newStreak, newBalance };
            });
        } catch (err) {
            if (err.message === 'ALREADY_CLAIMED') {
                logger.info(`[Wallet] Daily claim rejected: Already claimed`, { uid, dateId });
                throw new Error('You have already claimed your daily Zaps! Come back tomorrow.');
            }
            logger.error(`[Wallet] Daily claim failed for ${uid}:`, err);
            throw err;
        }
    }
}
