import { tryLock, releaseLock } from '../lib/db/locks.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * CONCURRENCY STRESS TEST
 * Verifies that firestore transactions correctly isolate simultaneous lock attempts.
 */

async function stressTest(uid) {
    if (!uid) {
        console.error('Usage: node scripts/stress-test-locks.js --uid <discordId>');
        process.exit(1);
    }

    console.log(`\n--- 🌋 STRESS TESTING LOCKS: ${uid} ---`);
    console.log(`Project: ${process.env.GCLOUD_PROJECT || 'dreambees-alchemist'}`);
    console.log('-------------------------------\n');

    try {
        // 1. Ensure lock is released first
        await releaseLock(uid);
        console.log('✅ Initialized: Lock is free.');

        // 2. Fire 10 simultaneous lock requests
        const totalAttempts = 10;
        console.log(`Firing ${totalAttempts} simultaneous lock requests via Promise.all()...\n`);

        const results = await Promise.all(
            Array.from({ length: totalAttempts }).map((_, i) => 
                tryLock(uid).then(success => ({ id: i, success })).catch(err => ({ id: i, success: false, error: err.message }))
            )
        );

        // 3. Analyze results
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        results.forEach(r => {
            const status = r.success ? '✅ SUCCESS' : '❌ REJECTED';
            console.log(`Request #${r.id.toString().padEnd(2)}: ${status} ${r.error ? `(${r.error})` : ''}`);
        });

        console.log('\n--- RESULTS ---');
        console.log(`Total Successes: ${successCount}`);
        console.log(`Total Rejections: ${failCount}`);

        if (successCount === 1) {
            console.log('\n✅ PASS: Concurrency verified. Exactly one request acquired the lock.\n');
        } else {
            console.error('\n❌ FAIL: INCONSISTENT LOCK STATE! Multiple successes or total failure.\n');
        }

        // Cleanup
        await releaseLock(uid);
        process.exit(0);
    } catch (err) {
        console.error('\n❌ STRESS TEST CRASHED');
        console.error(err);
        process.exit(1);
    }
}

// Parse UID from args
const args = process.argv.slice(2);
const uidArg = args.find(a => a.startsWith('--uid=') || a === '--uid')?.split('=')[1] || args[args.indexOf('--uid') + 1];

stressTest(uidArg || 'stress_test_user');
