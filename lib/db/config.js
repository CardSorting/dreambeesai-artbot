import { db, logger } from '../firebase.js';

const guildConfigCache = new Map();

/**
 * Fetches the configuration for a specific guild with a 5-minute TTL cache.
 * @param {string} guildId - The Discord guild ID.
 * @returns {Promise<Object>} The guild configuration or defaults.
 */
export async function getGuildConfig(guildId) {
    if (!guildId) return { reportThreshold: 3 };

    const cached = guildConfigCache.get(guildId);
    if (cached && (Date.now() - cached.timestamp < 300000)) {
        return cached.data;
    }

    try {
        const doc = await db.collection('artbot_guilds').doc(guildId).get();
        const data = doc.exists ? doc.data() : { reportThreshold: 3 };

        guildConfigCache.set(guildId, {
            data,
            timestamp: Date.now()
        });

        return data;
    } catch (err) {
        logger.error(`Failed to fetch guild config for ${guildId}`, err);
        return { reportThreshold: 3 };
    }
}

/**
 * Updates the configuration for a specific guild.
 * @param {string} guildId - The Discord guild ID.
 * @param {Object} config - The new configuration data.
 */
export async function setGuildConfig(guildId, config) {
    await db.collection('artbot_guilds').doc(guildId).set(config, { merge: true });
    guildConfigCache.delete(guildId);
}

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

let remoteConfigCache = null;
let lastConfigFetch = 0;

/**
 * Fetches dynamic configuration from Firestore with a 5-minute TTL cache.
 * Falls back to SAFE_DEFAULTS if DB is unreachable or document is missing.
 */
export async function getRemoteConfig() {
    const now = Date.now();
    if (remoteConfigCache && (now - lastConfigFetch < 300000)) {
        return remoteConfigCache;
    }

    try {
        const doc = await db.collection('artbot_system').doc('config').get();
        if (doc.exists) {
            remoteConfigCache = { ...SAFE_DEFAULTS, ...doc.data() };
            lastConfigFetch = now;
            return remoteConfigCache;
        }
    } catch (err) {
        logger.error("Failed to fetch remote config - using safe defaults", err);
    }

    return SAFE_DEFAULTS; 
}
