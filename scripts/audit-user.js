import { db } from '../lib/firebase.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * DATABASE AUDIT TOOL
 * Verifies Initial + Credits - Debits == Current Balance
 */

async function audit(uid) {
    if (!uid) {
        console.error('Usage: node scripts/audit-user.js --uid <discordId>');
        process.exit(1);
    }

    console.log(`\n--- 🔍 AUDITING USER: ${uid} ---`);
    console.log(`Project: ${process.env.GCLOUD_PROJECT || 'dreambees-alchemist'}`);
    console.log('-------------------------------\n');

    try {
        // 1. Fetch current profile
        const userDoc = await db.collection('artbot_users').doc(uid).get();
        if (!userDoc.exists) {
            console.error('❌ User not found in artbot_users.');
            return;
        }
        const currentBalance = userDoc.data().zaps || 0;
        console.log(`Current Recorded Balance: ${currentBalance} Zaps`);

        // 2. Fetch all transactions for this user
        const txSnap = await db.collection('artbot_transactions')
            .where('userId', '==', uid)
            .get();

        const docs = txSnap.docs.sort((a, b) => {
            const tA = a.data().timestamp?.toDate?.() || 0;
            const tB = b.data().timestamp?.toDate?.() || 0;
            return tA - tB;
        });

        console.log(`Found ${txSnap.size} total transactions.\n`);

        let calculatedBalance = 100; // Assuming 100 base provision
        let totalCredits = 0;
        let totalDebits = 0;

        console.log('--- TRANSACTION TRACE ---');
        console.log('Type | Amount | New Bal | Request ID');
        
        docs.forEach(doc => {
            const tx = doc.data();
            const amount = tx.amount || 0;
            
            if (tx.type === 'credit') {
                calculatedBalance += amount;
                totalCredits += amount;
            } else if (tx.type === 'debit') {
                calculatedBalance -= amount;
                totalDebits += amount;
            }
            
            calculatedBalance = Math.round(calculatedBalance * 100) / 100;
            
            console.log(`${tx.type.padEnd(6)} | ${amount.toString().padEnd(6)} | ${tx.newBalance.toString().padEnd(7)} | ${tx.requestId}`);
        });

        console.log('\n--- AUDIT SUMMARY ---');
        console.log(`Initial Provision : +100.00 Zaps`);
        console.log(`Total Credits     : +${totalCredits.toFixed(2)} Zaps`);
        console.log(`Total Debits      : -${totalDebits.toFixed(2)} Zaps`);
        console.log(`------------------------------`);
        console.log(`Calculated Total  :  ${calculatedBalance.toFixed(2)} Zaps`);
        console.log(`Recorded Balance  :  ${currentBalance.toFixed(2)} Zaps`);

        if (Math.abs(calculatedBalance - currentBalance) < 0.01) {
            console.log('\n✅ PASS: Mathematical integrity verified. No balance drift detected.\n');
        } else {
            console.error('\n❌ FAIL: INCONSISTENCY DETECTED! Mathematical audit failed.\n');
        }

        process.exit(0);
    } catch (err) {
        console.error('\n❌ AUDIT CRASHED');
        console.error(err);
        process.exit(1);
    }
}

// Parse UID from args
const args = process.argv.slice(2);
const uidArg = args.find(a => a.startsWith('--uid=') || a === '--uid')?.split('=')[1] || args[args.indexOf('--uid') + 1];

audit(uidArg || 'test_user_sim_v1');
