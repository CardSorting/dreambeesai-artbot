import 'dotenv/config';
import { HiveEngine } from '../src/core/HiveEngine.js';
import { HiveUX, HiveProxyInteraction } from '../src/core/HiveUX.js';

async function testSovereign() {
    console.log("🚀 Starting Sovereign Path Diagnostic...");
    
    // HiveEngine takes no arguments in its constructor
    const engine = new HiveEngine(); 
    
    // We mock the inner client to prevent it from actually connecting in this test
    (engine as any).client = { user: { tag: 'MockBot#1234' } };
    
    const mockPayload = {
        interactionId: 'test_mission_' + Date.now(),
        discordId: 'mock_user_123',
        channelId: 'mock_channel_456',
        prompt: 'A majestic golden bee flying over a cyberpunk city',
        modelId: 'wai-illustrious',
        guildId: 'mock_guild_789',
        createdAt: Date.now()
    };

    console.log(`📦 Enqueuing Mission: ${mockPayload.interactionId}`);
    
    try {
        // We override executeGeneration to check if it's called
        let wasExecuted = false;
        
        (engine as any).executeGeneration = async (payload: any) => {
            wasExecuted = true;
            console.log("✅ Worker received mission correctly!");
            console.log("Payload Checked:", payload.interactionId === mockPayload.interactionId);
            return { status: 'completed' };
        };

        await engine.enqueueGeneration(mockPayload);
        
        // Wait a small bit for the background task
        await new Promise(resolve => setTimeout(resolve, 500));

        if (wasExecuted) {
            console.log("🎊 SUCCESS: The Happy Path is active and local!");
        } else {
            console.log("❌ FAILURE: Mission reached the hive but wasn't dispatched.");
        }
    } catch (err) {
        console.error("💥 Diagnostic Crashed:", err);
    }
}

testSovereign().catch(console.error);
