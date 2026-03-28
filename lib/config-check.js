import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

const REQUIRED_CONFIG = [
    'DISCORD_TOKEN',
    'DREAMBEES_API_URL',
    'DREAMBEES_API_KEY',
    'DREAMBEES_GUILD_ID',
    'FIREBASE_PROJECT_ID'
];

/**
 * Validates the environment configuration and provides centralized access to constants.
 * This is a blocking check designed to run at the very start of index.js.
 */
export function validateConfig() {
    const missing = [];
    for (const key of REQUIRED_CONFIG) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }

    if (missing.length > 0) {
        logger.error(`[CRITICAL] Missing environment variables: ${missing.join(', ')}`);
        logger.error(`Please check your .env file and ensure all required values are set.`);
        process.exit(1);
    }

    // Secondary validation for formats
    try {
        const url = new URL(process.env.DREAMBEES_API_URL || '');
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Invalid protocol");
        
        // Environment Guardrail: prevent production project use on staging API
        const isStagingApi = url.hostname.includes('staging') || url.hostname.includes('localhost');
        const isProdProject = process.env.FIREBASE_PROJECT_ID === 'dreambees-alchemist';
        
        if (isProdProject && isStagingApi && process.env.NODE_ENV === 'production') {
            logger.error(`[CRITICAL] Environment Mismatch: Detected Production project ID with Staging API URL.`);
            process.exit(1);
        }
    } catch (e) {
        logger.error(`[CRITICAL] Invalid DREAMBEES_API_URL: Must be a valid URL starting with http/https.`);
        process.exit(1);
    }

    logger.info(`[Config] Environment validation successful. Hive is mission-ready. 🐝`);
}

export const CONFIG = {
    GUILD_ID: process.env.DREAMBEES_GUILD_ID || '1275879277895745536',
    API_URL: process.env.DREAMBEES_API_URL,
    API_KEY: process.env.DREAMBEES_API_KEY,
    IS_PROD: process.env.NODE_ENV === 'production',
    COSTS: {
        DREAM: 4,
        FLASH: 2,
        REMIX: 0.50,
        MOCKUP: 0.50,
        PRISM: 1.50,
        GACHA: 0.25,
        GRID: 1.00,
        VARIATION: 1.50,
        MATCH: 0.50
    }
};
