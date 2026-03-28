import dotenv from 'dotenv';
import { generateSingleImage } from '../lib/api/dreambees.js';
import { logger } from '../lib/logger.js';

dotenv.config();

async function runTest() {
    // Wait for auth to settle
    await new Promise(r => setTimeout(r, 2000));
    
    const userId = "test-user-direct-modal";
    const prompt = "A futuristic cyberpunk bee, high detail, neon lights, 4k";
    const modelId = "wai-illustrious";

    logger.info(`Starting Direct Modal Test (User: ${userId})...`);

    try {
        const result = await generateSingleImage(prompt, modelId, userId);
        
        logger.info("Test Success!");
        logger.info("Image URL: " + result.url);
        logger.info("Image ID: " + result.imageId);
        logger.info("Buffer Size: " + result.buffer.length);
        
        process.exit(0);
    } catch (err) {
        logger.error("Test Failed", err);
        process.exit(1);
    }
}

runTest();
