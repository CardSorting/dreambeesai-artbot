import 'dotenv/config';
import { HiveEngine } from '../src/core/HiveEngine.js';
import { HiveProxyInteraction } from '../src/core/HiveUX.js';
import { hivePersistence } from '../src/services/HivePersistence.js';

/**
 * CLAIM FIX AUDIT: Success & "Already Claimed" Flow
 * Verifies that the bot no longer crashes when double-claiming occurs.
 */
async function testClaimFix() {
    console.log("🧪 Starting Claim Fix Audit...");
    
    const engine = new HiveEngine();
    const testUserId = 'test_bee_123';
    
    // 1. Mock Interaction
    const mockInteraction = {
        id: 'test_claim_id_' + Date.now(),
        user: { id: testUserId, tag: 'TestBee#0001' },
        guildId: 'test_guild_456',
        deferred: false,
        replied: false,
        deferReply: async () => { 
            console.log("📨 [MOCK] Deferred Interaction");
            mockInteraction.deferred = true; 
        },
        reply: async (payload: any) => {
            if (mockInteraction.replied) throw new Error("Already Acknowledged");
            console.log("📨 [MOCK] Replied to Interaction:", JSON.stringify(payload).substring(0, 100));
            mockInteraction.replied = true;
        },
        editReply: async (payload: any) => {
            console.log("📨 [MOCK] Edited Reply:", JSON.stringify(payload).substring(0, 100));
        }
    };

    const proxy = new HiveProxyInteraction(mockInteraction as any);

    // 2. Setup Persistence Mock to throw ALREADY_CLAIMED
    console.log("\n💥 Simulating 'Already Claimed' flow...");
    (hivePersistence as any).claimDaily = async () => {
        throw new Error("ALREADY_CLAIMED: Simulated claim failure");
    };

    try {
        const claimCommand = (engine as any).commands.get('claim');
        await claimCommand.execute(proxy, { engine });
        console.log("✅ SUCCESS: Claim command executed without crashing.");
    } catch (err: any) {
        console.error("❌ FAILURE: Claim command crashed:", err);
    }

    process.exit(0);
}

testClaimFix().catch(err => {
    console.error("FATAL: Audit Crashed", err);
    process.exit(1);
});
