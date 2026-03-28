import { Wallet } from '../lib/wallet.js';
import { getOrCreateDiscordUser } from '../lib/db/users.js';
import { db, logger } from '../lib/firebase.js';
import dotenv from 'dotenv';
dotenv.config();

const testUserId = 'test_user_sim_v2';
const testTag = 'SimUser#2026';

async function simulate() {
    console.log('\n--- 🧪 ARTBOT TRANSACTION SIMULATION (REAL FIREBASE) ---');
    console.log(`Project: ${process.env.GCLOUD_PROJECT || 'dreambees-alchemist'}`);
    console.log(`User ID: ${testUserId}`);
    console.log('--------------------------------------------------------\n');

    try {
        // 1. Provision User (Implicitly grants 100 Zaps if new)
        console.log('[1/5] Provisioning Test User...');
        const user = await getOrCreateDiscordUser(testUserId, testTag, null);
        console.log(`✅ User Provisioned. Current Balance: ${user.zaps} Zaps\n`);

        // 2. Claim Daily Reward
        console.log('[2/5] Claiming Daily (Verification of Streaks & Credits)...');
        try {
            const claimResult = await Wallet.claimDaily(testUserId, { source: 'simulation_run' });
            console.log(`✅ Claim Success! Awarded: ${claimResult.rewardAmount} Zaps. New Balance: ${claimResult.newBalance} Zaps\n`);
        } catch (e) {
            if (e.message.includes('already claimed')) {
                console.log('ℹ️ User already claimed today. Skipping claim.\n');
            } else {
                throw e;
            }
        }

        // 3. Simulate Art Generation Debit
        const debitId = `sim_debit_${Date.now()}`;
        console.log(`[3/5] Simulating Generation Debit (ID: ${debitId})...`);
        const debitResult = await Wallet.debit(testUserId, 10, debitId, { source: 'simulation_run', model: 'xl-test' });
        console.log(`✅ Debit Success. New Balance: ${debitResult.newBalance} Zaps\n`);

        // 4. Simulate Error Recovery / Refund
        console.log(`[4/5] Simulating Refund for: ${debitId}...`);
        const refundResult = await Wallet.refund(debitId, 'Simulated Generation Failure');
        console.log(`✅ Refund Success. New Balance: ${refundResult.newBalance} Zaps\n`);

        // 5. Manual Credit Adjustment
        const creditId = `sim_credit_${Date.now()}`;
        console.log(`[5/5] Simulating Manual Credit (ID: ${creditId})...`);
        const creditResult = await Wallet.credit(testUserId, 50, creditId, { source: 'simulation_run', reason: 'Bulk Purchase Sim' });
        console.log(`✅ Credit Success. New Balance: ${creditResult.newBalance} Zaps\n`);

        // Final Balance Verification
        console.log('--- 📊 FINAL VERIFICATION ---');
        const finalSnap = await db.collection('artbot_users').doc(testUserId).get();
        const finalData = finalSnap.data();
        console.log(`Total Wallet Balance: ${finalData.zaps} Zaps`);
        console.log(`Last Transaction Time: ${finalData.lastTransactionTime?.toDate?.() || 'N/A'}`);
        console.log('Check your Firebase Console for the new artbot_transactions entries!');
        console.log('-------------------------------\n');

        process.exit(0);
    } catch (err) {
        console.error('\n❌ SIMULATION FAILED');
        console.error(err);
        process.exit(1);
    }
}

simulate();
