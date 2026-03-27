import { SlashCommandBuilder } from 'discord.js';
import { getOrCreateDiscordUser } from '../lib/db.js';
import { performGeneration } from '../lib/generator.js';
import { MODELS, calculateBatchCost } from '../lib/models.js';
import { logger } from '../lib/logger.js';

export const category = 'image';

const MODEL_ID = 'zit-h100-v1';
const MODEL_CONFIG = MODELS[MODEL_ID];
const BATCH_SIZE = 4;
const TOTAL_COST = calculateBatchCost(MODEL_ID, BATCH_SIZE);

const SAFETY_BLOCKLIST = [
    'nsfw', 'porn', 'gore', 'violence', 'blood', 'sex', 'nude', 'naked'
];

function sanitizePrompt(text) {
    if (!text) return '';
    return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F093}\u{1F191}-\u{1F251}\u{2B50}]/gu, '')
               .replace(/\s+/g, ' ')
               .trim();
}

export const data = new SlashCommandBuilder()
    .setName('flash')
    .setDescription(`${MODEL_CONFIG.commandDescription} (Costs ${TOTAL_COST} Zaps)`)
    .addStringOption(option =>
        option.setName('prompt')
            .setDescription('Describe the image you want to generate')
            .setRequired(true)
            .setMaxLength(1000));

export async function execute(interaction) {
    const discordId = interaction.user.id;
    const discordTag = interaction.user.tag;
    let originalPrompt = interaction.options.getString('prompt');
    const prompt = sanitizePrompt(originalPrompt);

    // 1. Safety Checks
    const lowerPrompt = prompt.toLowerCase();
    const isUnsafe = SAFETY_BLOCKLIST.some(word => lowerPrompt.includes(word));
    
    if (isUnsafe) {
        logger.warn(`Unsafe prompt rejected`, { discordId, discordTag, originalPrompt });
        return interaction.reply({ 
            content: `🛑 **Safety Alert!** Your prompt contains prohibited terms. Please keep it clean and creative!`, 
            ephemeral: true 
        });
    }

    if (prompt.length < 3) {
        return interaction.reply({ content: '❌ **Error!** Please provide a valid prompt (at least 3 characters).', ephemeral: true });
    }

    // 2. Fetch or Create Discord User Profile
    const userData = await getOrCreateDiscordUser(discordId, discordTag);

    // 3. Pre-flight Balance Check
    if ((userData.zaps || 0) < TOTAL_COST) {
        return interaction.reply({ 
            content: `❌ **Insufficient Zaps!** This generation costs **${TOTAL_COST} Zaps**, but you only have **${(userData.zaps || 0).toFixed(1)}**. \n\nYou can earn more Zaps by participating in community events!`, 
            ephemeral: true 
        });
    }

    // 4. Start Generation
    await interaction.deferReply();
    return performGeneration(interaction, userData.uid, prompt, MODEL_ID);
}
