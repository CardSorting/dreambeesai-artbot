import { db, admin } from '../lib/firebase.js';
import { saveGeneration } from '../lib/db/generations.js';
import { getOrCreateDiscordUser } from '../lib/db/users.js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const TEST_USERS = [
    { id: 'sim_user_alpha', tag: 'Alpha#0001' },
    { id: 'sim_user_beta', tag: 'Beta#0002' },
    { id: 'sim_user_gamma', tag: 'Gamma#0003' }
];

const PROMPTS = [
    "A majestic golden bee flying over a neon cyberpunk city, ultra detailed, 8k",
    "Surreal landscape with floating islands and giant sunflowers, dreamlike atmosphere",
    "Oil painting of a Victorian robot drinking tea in a garden",
    "Futuristic spaceship landing on a desert planet with two suns, cinematic lighting",
    "Adorable fluffy cat wearing a space suit, digital art style",
    "Abstract representation of artificial intelligence as a glowing neural network",
    "A cozy cabin in the woods during a thunderstorm, moody lighting, highly realistic",
    "Samurai warrior standing in a field of red spider lilies, anime style",
    "Underwater kingdom with bioluminescent coral reefs and mermaids",
    "Steampunk airship soaring through a sunset sky filled with brass clouds"
];

const MODELS = ['dream-xl', 'flash-turbo', 'artistic-v2'];

async function runSimulation() {
    console.log('\n--- 🐝 DREAMBEES GENERATION SIMULATOR ---');
    console.log(`Target Project: ${process.env.GCLOUD_PROJECT || 'dreambees-alchemist'}`);
    console.log('------------------------------------------\n');

    try {
        // 1. Provision / Verify Test Users
        console.log('[1/3] Ensuring simulation users exist...');
        for (const user of TEST_USERS) {
            await getOrCreateDiscordUser(user.id, user.tag, null);
            console.log(`   - Verified: ${user.tag} (${user.id})`);
        }
        console.log('✅ Users Ready.\n');

        // 2. Generate Simulated Records
        const numGenerations = 15;
        console.log(`[2/3] Simulating ${numGenerations} generations...`);

        for (let i = 0; i < numGenerations; i++) {
            const user = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)];
            const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
            const modelId = MODELS[Math.floor(Math.random() * MODELS.length)];
            const interactionId = `sim_gen_${crypto.randomBytes(8).toString('hex')}`;
            const success = Math.random() > 0.1; // 90% success rate
            const duration = Math.floor(Math.random() * 8000) + 2000; // 2-10 seconds
            const cost = 4.0;

            const generationData = {
                discordUserId: user.id,
                prompt,
                modelId,
                cost,
                success,
                duration,
                metadata: {
                    simulated: true,
                    timestamp: new Date().toISOString()
                }
            };

            if (success) {
                generationData.gridUrl = `https://picsum.photos/seed/${interactionId}/1024/1024`;
                generationData.individualUrls = [
                    `https://picsum.photos/seed/${interactionId}_1/512/512`,
                    `https://picsum.photos/seed/${interactionId}_2/512/512`,
                    `https://picsum.photos/seed/${interactionId}_3/512/512`,
                    `https://picsum.photos/seed/${interactionId}_4/512/512`
                ];
            } else {
                generationData.error = "Simulated generation failure: GPU node disconnected";
            }

            // Save to Firestore
            await saveGeneration(interactionId, generationData);
            
            // Also create a transaction record to keep the audit trail clean
            const transactionId = `txn_${interactionId}`;
            await db.collection('artbot_transactions').doc(transactionId).set({
                userId: user.id,
                amount: -cost,
                type: 'debit',
                source: 'simulated_batch',
                description: `Generation Simulation: ${prompt.substring(0, 30)}...`,
                referenceId: interactionId,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`   [${i + 1}/${numGenerations}] ${success ? '✅' : '❌'} User: ${user.tag} | Prompt: "${prompt.substring(0, 40)}..."`);
        }

        console.log('\n[3/3] Finalizing simulation...');
        console.log('✅ All simulated records successfully written to Firestore.');
        console.log('Check your Firebase console under "artbot_generations" and "artbot_transactions".');
        console.log('------------------------------------------\n');

        process.exit(0);
    } catch (err) {
        console.error('\n❌ SIMULATION FAILED');
        console.error(err);
        process.exit(1);
    }
}

runSimulation();
