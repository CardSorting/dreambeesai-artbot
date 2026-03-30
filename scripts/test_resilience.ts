import { HiveEngine } from '../src/core/HiveEngine.js';
import { HiveConfig } from '../src/core/HiveConfig.js';

/**
 * RESILIENCE AUDIT: Circuit Breaker & Configuration Validation
 * Verifies that the Hive protects itself from infrastructure failure.
 */
async function testResilience() {
    console.log("🧪 Starting Resilience & Circuit Breaker Audit...");
    
    try {
        HiveConfig.validate();
        console.log("✅ Configuration Validation Passed.");
    } catch (err: any) {
        console.error("❌ Configuration Validation Failed:", err.message);
        process.exit(1);
    }
    
    const engine = new HiveEngine();
    
    // 1. Initial State
    const initialStatus = (engine as any).breakers.generation.status;
    console.log(`Initial Breaker Status: ${initialStatus}`);

    // 2. Simulate Failures
    console.log("\n💥 Simulating 3 consecutive mission failures...");
    (engine as any).tripBreaker('generation');
    (engine as any).tripBreaker('generation');
    (engine as any).tripBreaker('generation');

    const trippedStatus = (engine as any).breakers.generation.status;
    console.log(`Current Breaker Status: ${trippedStatus}`);

    if (trippedStatus === 'OPEN') {
        console.log("✅ SUCCESS: Circuit Breaker TRIPPED correctly.");
    } else {
        console.error("❌ FAILURE: Circuit Breaker remained CLOSED.");
    }

    // 3. Test Blockage
    console.log("\n🛡️ Verifying mission blockage while OPEN...");
    try {
        await engine.enqueueGeneration({ interactionId: 'test_blocked' });
        console.error("❌ FAILURE: Mission enqueued while breaker was OPEN.");
    } catch (err: any) {
        if (err.message.includes('SYSTEM_DEGRADED')) {
            console.log("✅ SUCCESS: System correctly blocked mission with SYSTEM_DEGRADED.");
        } else {
            console.error("❌ Unexpected Error:", err.message);
        }
    }

    // 4. Test Reset
    console.log("\n✨ Simulating manual reset...");
    (engine as any).resetBreaker('generation');
    const resetStatus = (engine as any).breakers.generation.status;
    console.log(`Status after Reset: ${resetStatus}`);
    
    if (resetStatus === 'CLOSED') {
        console.log("✅ SUCCESS: Circuit Breaker RESET correctly.");
    } else {
        console.error("❌ FAILURE: Circuit Breaker failed to RESET.");
    }

    process.exit(0);
}

testResilience().catch(err => {
    console.error("FATAL: Resilience Audit Crashed", err);
    process.exit(1);
});
