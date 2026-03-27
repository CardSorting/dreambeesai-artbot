import { db, admin } from './db.js';
import { logger } from './logger.js';

export class Wallet {
    static async debit(uid, amount, requestId, metadata = {}, currency = 'zaps') {
        if (!uid) throw new Error('User must be authenticated.');
        if (!requestId) throw new Error('requestId is required for financial transactions.');
        if (amount < 0) throw new Error('Debit amount cannot be negative.');

        const userRef = db.collection('discord_users').doc(uid);
        const transactionRef = db.collection('wallet_transactions').doc(requestId);

        return await db.runTransaction(async (t) => {
            const existingTx = await t.get(transactionRef);
            if (existingTx.exists) {
                const data = existingTx.data();
                return { success: true, idempotent: true, newBalance: data.newBalance };
            }

            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error('Discord User not found.');

            const userData = userDoc.data();
            const currentBalance = userData[currency] || 0; // Initialize if missing

            if (amount > 0 && currentBalance < amount) {
                throw new Error(`Insufficient ${currency}. Need ${amount}, have ${currentBalance.toFixed(1)}`);
            }

            const newBalance = Math.round((currentBalance - amount) * 100) / 100; // Prevent float drift

            const userUpdate = {
                [currency]: newBalance,
                lastTransactionTime: admin.firestore.FieldValue.serverTimestamp()
            };

            t.update(userRef, userUpdate);

            const ledgerEntry = {
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
            };

            t.set(transactionRef, ledgerEntry);

            return { success: true, transactionId: requestId, newBalance, idempotent: false };
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
}
