import { SlashCommandBuilder } from 'discord.js';
import { getOrCreateDiscordUser } from '../lib/db.js';
import { performGeneration } from '../lib/generator.js';
import { MODELS, calculateBatchCost } from '../lib/models.js';
import { logger } from '../lib/logger.js';
import * as Hive from '../lib/hive.js';

export const category = 'image';

const MODEL_ID = 'zit-h100-v1';
const MODEL_CONFIG = MODELS[MODEL_ID];
const BATCH_SIZE = 4;
const TOTAL_COST = calculateBatchCost(MODEL_ID, BATCH_SIZE);


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
    const prompt = Hive.refineNectar(originalPrompt);

    // 1. Safety Checks (Queen's Guard)
    const isSafe = await Hive.guardHive(prompt, { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag, 
        guildId: interaction.guildId 
    });

    if (!isSafe) {
        logger.warn(`Unsafe prompt rejected`, { discordId, discordTag, originalPrompt });
        return interaction.reply({ content: Hive.Voice.safety, ephemeral: true });
    }

    if (prompt.length < 3) {
        return interaction.reply({ content: Hive.Voice.shortNectar, ephemeral: true });
    }

    // 2. Fetch or Create Discord User Profile
    const userData = await getOrCreateDiscordUser(discordId, discordTag);

    // 3. Pre-flight Balance Check
    if ((userData.zaps || 0) < TOTAL_COST) {
        return interaction.reply({ 
            content: Hive.Voice.emptyJar(TOTAL_COST, userData.zaps || 0), 
            ephemeral: true 
        });
    }

    // 4. Start Generation
    await interaction.deferReply();
    return performGeneration(interaction, userData.uid, prompt, MODEL_ID);
}
