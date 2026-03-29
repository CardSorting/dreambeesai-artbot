import 'dotenv/config';
import { HiveEngine } from '../src/core/HiveEngine.js';
import { HiveUX } from '../src/core/HiveUX.js';
import { AttachmentBuilder } from 'discord.js';
import { hivePersistence, COLLECTIONS } from '../src/services/HivePersistence.js';

/**
 * HEADLESS PIPELINE DIAGNOSTIC
 * Tests the worker execution path WITHOUT a live Discord connection.
 */
async function testPipelineStandalone() {
    console.log("🐜 Starting Headless Pipeline Diagnostic...");
    
    // --- SETTINGS ---
    const USE_MOCK_AI = false; // Set to false to test real Modal credits
    const testInteractionId = 'headless_mission_' + Date.now();

    // --- 1. MOCK DISCORD INTERFACE ---
    const mockChannel = {
        id: 'mock_channel_789',
        send: async (payload: any) => {
            console.log("\n📬 [MOCK DISCORD] Message Sent to Channel:");
            if (payload.content) console.log(`  > Content: ${payload.content}`);
            if (payload.embeds) {
                console.log(`  > Embeds: ${payload.embeds.length} detected`);
                payload.embeds.forEach((e: any, i: number) => {
                    console.log(`    [${i}] Title: ${e.data?.title} | Description: ${e.data?.description?.substring(0, 50)}...`);
                });
            }
            if (payload.files) {
                console.log(`  > Attachments: ${payload.files.length} detected`);
                payload.files.forEach((f: any, i: number) => {
                    console.log(`    [${i}] Name: ${f.name} | Data Size: ${f.attachment?.length || 'unknown'} bytes`);
                });
            }
            if (payload.components) console.log(`  > Components: ${payload.components.length} rows detected`);
            
            return { 
                id: 'mock_msg_' + Date.now(), 
                delete: async () => console.log("🗑️ [MOCK DISCORD] Temporary processing message deleted.") 
            };
        }
    };

    const mockClient = {
        channels: {
            fetch: async (id: string) => {
                console.log(`🔍 [MOCK DISCORD] Fetching channel: ${id}`);
                return mockChannel;
            }
        },
        user: { tag: 'HeadlessHive#0000' }
    };

    // --- 2. INSTANTIATE ENGINE ---
    const engine = new HiveEngine();
    (engine as any).client = mockClient;

    // --- 3. MOCK GENERATOR (Optional) ---
    if (USE_MOCK_AI) {
        console.log("🧪 Using MOCK AI for safe plumbing test.");
        (engine as any).hiveGenerator.generate = async (task: any) => {
            console.log("🤖 [MOCK AI] Generating dummy nectar...");
            // Return 4 tiny 1x1 base64 pixels (valid webp/png stubs)
            const dummyB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
            return {
                status: 'completed',
                images: [dummyB64, dummyB64, dummyB64, dummyB64],
                modelId: task.modelId
            };
        };
    }

    // --- 4. PREPARE TASK PAYLOAD ---
    console.log("🗄️ Waiting for HivePersistence...");
    await (hivePersistence as any).initPromise;
    console.log("🗄️ HivePersistence Ready.");

    const task = {
        interactionId: testInteractionId,
        discordId: 'mock_user_123',
        channelId: mockChannel.id,
        prompt: 'A microscopic view of a cyber-organic flower with nectar made of glowing honey',
        modelId: 'wai-illustrious',
        guildId: 'mock_guild_456',
        createdAt: Date.now()
    };

    console.log(`📦 Enqueuing Mission: ${task.interactionId}`);

    try {
        // --- 5. EXECUTE PIPELINE ---
        // We directly call the worker logic
        console.log("⚡ Executing Pipeline...");
        await (engine as any).executeGeneration(task);

        console.log("\n✅ Pipeline Logic Finished Execution.");

        // --- 6. VERIFY DATABASE ---
        console.log("🗄️ Verifying Database State...");
        const genRef = hivePersistence.collection(COLLECTIONS.GENERATIONS).doc(testInteractionId);
        const record = await (hivePersistence as any).getDocCompat(genRef);
        
        if (record.exists && record.data().status === 'completed') {
            console.log("🎉 SUCCESS: Firestore record marked COMPLETED.");
        } else {
            console.log("❌ FAILURE: Firestore record status is mismatch or missing.");
            console.log("Current State:", record.data());
        }

    } catch (err) {
        console.error("💥 Pipeline Diagnostic Crashed:", err);
    } finally {
        // No process.exit() here to let the final logs flush
    }
}

testPipelineStandalone().catch(console.error);
