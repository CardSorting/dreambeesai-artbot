import filter from 'leo-profanity';
import { logger } from './logger.js';
import { 
    normalizeForSafety, 
    HIGH_RISK_TERMS, 
    MEDIUM_RISK_TERMS, 
    SAFETY_BLOCKLIST,
    executeQueenGuardScan
} from './safety-utils.js';
import { logModerationEvent, getAbuseBackoff } from './moderation-audit.js';

export const DREAMBEES_GUILD_ID = '1275879277895745536';
export const INVITE_LINK = 'https://discord.com/invite/curMHRAN8y';

// Initialize the Queen's Guard filter
filter.add(SAFETY_BLOCKLIST);

/**
 * Checks if a user is a member of the official DreamBees Hive (Server).
 */
export async function isResiding(interaction) {
    if (!interaction) return false;
    const discordId = interaction.user?.id;
    if (!discordId) return false;

    const targetGuildId = process.env.DREAMBEES_GUILD_ID || DREAMBEES_GUILD_ID;
    
    // Fast path: check current guild
    let isMember = (interaction.guildId === targetGuildId);
    
    // Thorough path: check client cache/fetch if not in the official server already
    if (!isMember && interaction.client?.guilds) {
        try {
            const client = interaction.client;
            const guild = client.guilds.cache.get(targetGuildId) || await client.guilds.fetch(targetGuildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(discordId).catch(() => null);
                if (member) isMember = true;
            }
        } catch (e) {
            logger.error(`Hive residency check failed for ${discordId}`, { error: e.message });
        }
    }
    return isMember;
}

/**
 * Refines a prompt (Nectar) for Hive processing.
 * Whitelists only safe characters (alphanumeric, spaces, and basic symbols).
 */
export function refineNectar(text) {
    if (!text) return '';
    
    // Whitelist approach: keep letters, numbers, spaces, and common punctuation
    // Strips all emojis, control characters, and obscure Unicode symbols.
    return text
        .replace(/[^a-zA-Z0-9\s.,!?'"()/+-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Checks if a prompt (Nectar) is Queen-approved (Safe).
 * @returns {boolean} True if approved/safe.
 */
export async function guardHive(prompt, context = {}) {
    if (!prompt) return false;
    const { userId, userTag, guildId } = context;
    
    // 0. Abuse Backoff Check
    if (userId) {
        const backoff = await getAbuseBackoff(userId);
        if (backoff > 0) {
            logger.warn(`Abuse backoff active for ${userId}`, { userId, backoff });
            return false;
        }
    }

    // 1-3. Execute Advanced Multi-Pass Scan
    const scan = await executeQueenGuardScan(prompt, filter);
    
    if (!scan.approved) {
        await logModerationEvent({ 
            userId, 
            userTag, 
            guildId, 
            originalPrompt: prompt, 
            matchedTerm: scan.matchedTerm,
            category: scan.category,
            score: scan.score,
            normalizedForms: normalizeForSafety(prompt)
        });
        return false;
    }

    return true;
}

/**
 * The unified voice of the DreamBees Hive.
 */
export const Voice = {
    restriction: `🚫 **Harvest Restricted!** 🐝\n\nYour daily Zaps are kept safe inside the **DreamBees Hive**. To unlock your daily rewards and join the community of creators, please join our official server!\n\n✨ **Unlock your rewards here:** ${INVITE_LINK}`,
    safety: `🛑 **Queen's Guard Alert!** Your prompt contains prohibited terms. Please keep it clean and creative!`,
    emptyJar: (cost, balance) => `🍯 **Empty Jar!** This harvest requires **${cost} Zaps**, but you only have **${balance.toFixed(1)}**. \n\nYou can earn more Zaps by participating in community events!`,
    shortNectar: `🐝 **Bzzzzt!** We need a real nectar source to start! (Prompt too short)`,
    failure: `❌ **Bot Error:** Something went wrong in the Hive. The worker bees have been notified! Please try again later.`,
    capacity: `🔥 **Hive Swarmed!** We're currently at maximum capacity. Please wait a moment for the honey to settle!`
};
