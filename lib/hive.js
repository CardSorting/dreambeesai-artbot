import filter from 'leo-profanity';
import { logger } from './logger.js';
import { normalizeForSafety, HIGH_RISK_TERMS, MEDIUM_RISK_TERMS } from './safety-utils.js';
import { logModerationEvent, getAbuseBackoff } from './moderation-audit.js';

export const DREAMBEES_GUILD_ID = '1275879277895745536';
export const INVITE_LINK = 'https://discord.com/invite/curMHRAN8y';

export const SAFETY_BLOCKLIST = [
    'nsfw', 'porn', 'p0rn', 'gore', 'violence', 'violent', 'blood', 'bloody', 
    'sex', 'sexual', 'nude', 'naked', 'hentai', 'r18', 'erotica', 'undress', 
    'lingerie', 'killing', 'murder', 'dead', 'death', 'suicide', 'abuse'
];

// Initialize the Queen's Guard filter
filter.add(SAFETY_BLOCKLIST);

/**
 * Checks if a user is a member of the official DreamBees Hive (Server).
 */
export async function isResiding(interaction) {
    const discordId = interaction.user.id;
    const targetGuildId = process.env.DREAMBEES_GUILD_ID || DREAMBEES_GUILD_ID;
    
    let isMember = interaction.guildId === targetGuildId;
    if (!isMember) {
        try {
            const guild = await interaction.client.guilds.fetch(targetGuildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(discordId).catch(() => null);
                if (member) isMember = true;
            }
        } catch (e) {
            logger.error(`Hive residency check failed for ${discordId}`, e);
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
    
    // 0. Abuse Backoff Check (Optional/Contextual)
    if (userId) {
        const backoff = await getAbuseBackoff(userId);
        if (backoff > 0) {
            logger.warn(`Abuse backoff active for ${userId}`, { userId, backoff });
            return false; // Silently block or handle in caller
        }
    }

    // 1. Initial Library Check (Original)
    if (filter.check(prompt)) {
        await logModerationEvent({ userId, userTag, guildId, originalPrompt: prompt, matchedTerm: 'library_default' });
        return false;
    }

    // 2. Multi-Pass Normalization Scrutiny (Deep Scan)
    const forms = normalizeForSafety(prompt);
    
    // Layer 1: Library check on normalized/de-obfuscated version
    if (filter.check(forms.deobfuscated)) {
        await logModerationEvent({ 
            userId, userTag, guildId, 
            originalPrompt: prompt, 
            normalizedForms: forms, 
            matchedTerm: 'library_deobfuscated' 
        });
        return false;
    }

    // Layer 2: Tiered Blocklist Inspection
    const allTerms = [...SAFETY_BLOCKLIST];
    
    for (const term of allTerms) {
        const isHighRisk = HIGH_RISK_TERMS.includes(term);
        
        // A. Whole-Word Check (Lowercase & Deobfuscated)
        // Helps avoid Scunthorpe issues like "assumed dead"
        const wordRegex = new RegExp(`\\b${term}\\b`, 'i');
        if (wordRegex.test(forms.lowercase)) {
            await logModerationEvent({ userId, userTag, guildId, originalPrompt: prompt, matchedTerm: `word:${term}` });
            return false;
        }
        if (wordRegex.test(forms.deobfuscated)) {
            await logModerationEvent({ userId, userTag, guildId, originalPrompt: prompt, matchedTerm: `deobf_word:${term}` });
            return false;
        }

        // B. Condensed/Substring Check (For spacing bypasses)
        // Only trigger on condensed form if High Risk (e.g. "p o r n") 
        // OR if the original term was explicitly padded with symbols.
        if (isHighRisk && forms.condensed.includes(term)) {
            await logModerationEvent({ userId, userTag, guildId, originalPrompt: prompt, matchedTerm: `condensed_high:${term}` });
            return false;
        }

        // C. Scatter Fragments (Detect "v...i...o...l...e...n...c...e")
        // We only do this for terms where spacing bypass is common.
        if (isHighRisk || term.length > 4) {
            const scatterRegex = new RegExp(term.split('').join('[^a-z0-9]*'), 'i');
            if (scatterRegex.test(forms.deobfuscated) && !wordRegex.test(forms.deobfuscated)) {
                await logModerationEvent({ userId, userTag, guildId, originalPrompt: prompt, matchedTerm: `scatter:${term}` });
                return false;
            }
        }
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
    shortNectar: `🐝 **Bzzzzt!** We need a real nectar source to start! (Prompt too short)`
};
