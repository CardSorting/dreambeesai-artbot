import { logger } from './logger.js';

export const DREAMBEES_GUILD_ID = '1275879277895745536';
export const INVITE_LINK = 'https://discord.com/invite/curMHRAN8y';

export const SAFETY_BLOCKLIST = [
    'nsfw', 'porn', 'gore', 'violence', 'blood', 'sex', 'nude', 'naked',
    'hentai', 'r18', 'erotica', 'undress', 'lingerie'
];

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
 */
export function refineNectar(text) {
    if (!text) return '';
    return text
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F093}\u{1F191}-\u{1F251}\u{2B50}]/gu, '')
        .replace(/[^\x20-\x7E\s]/g, '') // Remove non-printable characters
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Checks if a prompt (Nectar) is Queen-approved (Safe).
 * @returns {boolean} True if approved/safe.
 */
export function guardHive(prompt) {
    if (!prompt) return false;
    const lowerPrompt = prompt.toLowerCase();
    return !SAFETY_BLOCKLIST.some(word => lowerPrompt.includes(word));
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
