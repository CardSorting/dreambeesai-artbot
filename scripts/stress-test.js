import dotenv from 'dotenv';
dotenv.config();

import { performGeneration } from '../lib/generator.js';
import { logger } from '../lib/logger.js';

/**
 * MOCK INTERACTION OBJECT
 */
function createMockInteraction(id) {
    return {
        id: `mock_interaction_${id}`,
        user: { id: 'admin_test_user', tag: 'Tester#0001', displayAvatarURL: () => 'https://example.com/avatar.png' },
        guildId: 'test_guild',
        channelId: 'test_channel',
        editReply: async (payload) => {
            // console.log(`[Mock Interaction ${id}] Reply:`, payload.content || 'Embed/File');
            return payload;
        }
    };
}

async function runStressTest() {
    logger.info("🐝 Starting DreamBees Hive Stress Test...");
    logger.info("🚀 Simulating 15 concurrent generations to test local locks and global capacity...");

    const activeJobs = new Map();
    const startTime = Date.now();
    
    // Simulate 15 parallel generations
    const testRuns = Array.from({ length: 15 }).map(async (_, i) => {
        const interaction = createMockInteraction(i);
        try {
            // We pass the activeJobs map to performGeneration just like index.js does
            await performGeneration(interaction, 'test-uid', 'A futuristic cyberpunk beehive neon gold', 'wai-illustrious', { 
                jobs: activeJobs,
                logger: logger.child({ testId: i })
            });
            return { id: i, status: 'success' };
        } catch (err) {
            return { id: i, status: 'failed', error: err.message };
        }
    });

    const results = await Promise.all(testRuns);
    const duration = (Date.now() - startTime) / 1000;

    const successes = results.filter(r => r.status === 'success').length;
    const failures = results.filter(r => r.status === 'failed').length;
    const swarmed = results.filter(r => r.error === 'Hive Swarmed!').length;

    logger.info(`📊 STRESS TEST RESULTS (${duration.toFixed(2)}s)`, {
        successes,
        failures,
        swarmed,
        activeJobs: activeJobs.size
    });

    if (activeJobs.size === 0 && successes > 0) {
        logger.info("✨ HIVE STABILITY VERIFIED: All jobs accounted for and drained. 🐝");
    } else if (activeJobs.size > 0) {
        logger.error("⚠️  HIVE LEAK DETECTED: Active jobs map not empty!", { size: activeJobs.size });
        process.exit(1);
    }
}

runStressTest().catch(err => {
    console.error("Stress test crashed", err);
    process.exit(1);
});
