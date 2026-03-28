import { db, admin, logger } from '../firebase.js';

/**
 * Recovers "Zombie" transactions (Pending transactions that never finished).
 */
export async function recoverZombieTransactions() {
    const STALE_THRESHOLD_MINS = 10;
    const now = new Date();
    const staleTime = new Date(now.getTime() - STALE_THRESHOLD_MINS * 60 * 1000);

    let staleSnap;
    try {
        staleSnap = await db.collection('artbot_transactions')
            .where('status', '==', 'pending')
            .where('timestamp', '<', staleTime)
            .limit(50)
            .get();
    } catch (err) {
        if (err.code === 9 || err.message.includes('index')) {
            logger.warn("[Maintenance] Transaction recovery is currently disabled (Missing Firestore Index).");
            logger.warn("Visit the following URL to enable it:");
            logger.warn("https://console.firebase.google.com/v1/r/project/dreambees-alchemist/firestore/indexes?create_composite=Cl9wcm9qZWN0cy9kcmVhbWJlZXMtYWxjaGVtaXN0L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9hcnRib3RfdHJhbnNhY3Rpb25zL2luZGV4ZXMvXxABGgoKBnN0YXR1cxABGg0KCXRpbWVzdGFtcBABGgwKCF9fbmFtZV9fEAE");
        } else {
            logger.error("Unexpected error during zombie transaction query", err);
        }
        return 0;
    }

    if (staleSnap.empty) return 0;

    logger.info(`Found ${staleSnap.size} zombie transactions. Attempting recovery...`);

    let recoveredCount = 0;
    for (const doc of staleSnap.docs) {
        const tx = doc.data();
        try {
            // Check if generation record exists (maybe it finished but status update failed?)
            const genDoc = await db.collection('artbot_generations').doc(doc.id).get();
            if (genDoc.exists) {
                // It actually finished! Just update the status.
                await db.collection('artbot_transactions').doc(doc.id).update({
                    status: 'completed',
                    recoveredAt: admin.firestore.FieldValue.serverTimestamp()
                });
                logger.info(`Zombie ${doc.id} marked as completed (generation exists).`);
                continue;
            }

            // No generation found. Issuing refund.
            const { Wallet } = await import('../wallet.js'); // Lazy import to avoid circular dependency
            const refundId = `${doc.id}_zombie_refund`;

            await Wallet.credit(tx.userId, tx.amount, refundId, {
                reason: 'Zombie Recovery',
                originalTxId: doc.id,
                source: 'system'
            });

            await db.collection('artbot_transactions').doc(doc.id).update({
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
