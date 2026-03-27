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
        const doc = await db.collection('discord_guilds').doc(guildId).get();
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
    await db.collection('discord_guilds').doc(guildId).set(config, { merge: true });
    guildConfigCache.delete(guildId);
}

let remoteConfigCache = null;
let lastConfigFetch = 0;

/**
 * Fetches dynamic configuration from Firestore with a 5-minute TTL cache.
 */
export async function getRemoteConfig() {
    const now = Date.now();
    if (remoteConfigCache && (now - lastConfigFetch < 300000)) {
        return remoteConfigCache;
    }

    try {
        const doc = await db.collection('system').doc('config').get();
        if (doc.exists) {
            remoteConfigCache = doc.data();
            lastConfigFetch = now;
            return remoteConfigCache;
        }
    } catch (err) {
        logger.error("Failed to fetch remote config", err);
    }

    return {}; // Return empty if failed/missing
}
