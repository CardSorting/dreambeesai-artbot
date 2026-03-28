import { db, admin, logger } from '../lib/firebase.js';
import dotenv from 'dotenv';
dotenv.config();

const SAFE_DEFAULTS = {
    dailyRewardAmount: 100,
    streakBonusAmount: 10,
    maxStreakBonus: 100,
    generationCost: 4.0,
    upscaleCost: 0.5,
    remixCost: 0.5,
    muralCost: 8.0,
    prismCost: 20.0,
    globalCooldownMs: 30000,
    maxPromptLength: 500,
    reportThreshold: 3
};

async function provision() {
    console.log('--- ARTBOT DATABASE PROVISIONING ---');
    console.log(`Target Project: ${process.env.GCLOUD_PROJECT || 'dreambees-alchemist'}`);
    console.log('------------------------------------\n');

    try {
        // 1. Seed System Configuration
        console.log('[1/2] Seeding Global Configuration...');
        const configRef = db.collection('artbot_system').doc('config');
        await configRef.set(SAFE_DEFAULTS, { merge: true });
        console.log('✅ Created/Updated: artbot_system/config\n');

        // 2. Initialize Collections (No-op metadata writes)
        console.log('[2/2] Initializing Isolated Collections...');
        const collections = [
            'artbot_users',
            'artbot_generations',
            'artbot_transactions',
            'artbot_guilds',
            'artbot_locks',
            'artbot_cooldowns',
            'artbot_studios',
            'artbot_reports'
        ];

        const batch = db.batch();
        const now = admin.firestore.FieldValue.serverTimestamp();

        for (const coll of collections) {
            const docRef = db.collection(coll).doc('_metadata');
            batch.set(docRef, { 
                initialized: true, 
                initializedAt: now,
                note: "Storage for ArtBot-isolated data"
            }, { merge: true });
            console.log(`- Queued: ${coll}`);
        }

        await batch.commit();
        console.log('\n✅ All collections successfully initialized with metadata documents.');
        console.log('\n--- PROVISIONING COMPLETE ---');
        console.log('The collections should now be visible in your Firebase console.');
        
        process.exit(0);
    } catch (err) {
        console.error('\n❌ PROVISIONING FAILED');
        console.error(err);
        process.exit(1);
    }
}

provision();
