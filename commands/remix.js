import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fetchWithTimeout, keepAliveAgent } from '../lib/api/dreambees.js';
import { saveGeneration } from '../lib/db/generations.js';
import { getUserByDiscordId } from '../lib/db/users.js';
import { logger } from '../lib/logger.js';
import * as Hive from '../lib/hive.js';

export const data = new SlashCommandBuilder()
    .setName('remix')
    .setDescription('💡 Universal Remix: Evolve any image via URL or DreamBees ID')
    .addStringOption(option => 
        option.setName('input')
            .setDescription('The URL of the image or a DreamBees Image ID')
            .setRequired(true));

export const category = 'image';

export async function execute(interaction) {
    const input = interaction.options.getString('input').trim();
    const discordId = interaction.user.id;
    await interaction.deferReply({ ephemeral: true });

    const userProfile = await getUserByDiscordId(discordId);
    if (!userProfile) {
        return interaction.editReply({ content: '❌ Please link your account first at https://dreambeesai.com' });
    }

    try {
        let imageUrl = '';
        let prompt = 'Imported for Remix';
        let imageId = 'external';

        // 1. Resolve Input (URL or ID)
        if (input.startsWith('http')) {
            try {
                const url = new URL(input);
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Invalid protocol");
                imageUrl = input;
            } catch (err) {
                return interaction.editReply({ content: '❌ Please provide a valid HTTP/HTTPS image URL.' });
            }
        } else {
            // Assume Image ID and fetch from backend
            const API_URL = process.env.DREAMBEES_API_URL;
            const API_KEY = process.env.DREAMBEES_API_KEY;

            const response = await fetchWithTimeout(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
                body: JSON.stringify({
                    data: { action: "getImageDetail", imageId: input }
                }),
                agent: keepAliveAgent
            }, 10000);

            if (response.ok) {
                const { result } = await response.json();
                imageUrl = result.imageUrl;
                prompt = result.prompt;
                imageId = input;
            } else {
                return interaction.editReply({ content: `❌ Could not find a DreamBees image with ID: \`${input}\`. Please provide a valid URL or ID.` });
            }
        }

        // 2. Create a "Virtual" Generation Record for the interaction
        const interactionId = `remix_ext_${interaction.id}`;
        await saveGeneration(interactionId, {
            prompt,
            modelId: "imported",
            userId: discordId,
            dreambeesUid: userProfile.uid,
            guildId: interaction.guildId,
            urls: [imageUrl],
            imageIds: [imageId],
            gridUrl: imageUrl,
            cost: 0
        });

        // 3. Show the Remix Studio UI
        const embed = new EmbedBuilder()
            .setTitle('🍯 Universal Remix Hive')
            .setDescription(`**Target Honey:** [Direct Link](${imageUrl})\n**Original Nectar:** ${prompt.substring(0, 200)}...\n\nSelect a floral vibe below or click "Manual Remix" to provide custom pollination instructions.`)
            .setImage(imageUrl)
            .setColor('#fbbf24') // Golden Bee
            .setFooter({ text: 'DreamBees Hive • Universal Image Evolution' });

        const syncRow = new ActionRowBuilder().addComponents(
             new ButtonBuilder()
                .setCustomId(`remix_upscale_${interactionId}_0`)
                .setLabel('Manual Remix 💡')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`remix_vibegrid_${interactionId}_0`)
                .setLabel('Elite Vibe Grid 🎰')
                .setStyle(ButtonStyle.Success)
        );

        const vibeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${interactionId}_0_cyberpunk`)
                .setLabel('Cyberpunk ⚡')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${interactionId}_0_studio`)
                .setLabel('Studio 📸')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${interactionId}_0_anime`)
                .setLabel('Anime 🌸')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${interactionId}_0_dark`)
                .setLabel('Dark 🌑')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({
            embeds: [embed],
            components: [syncRow, vibeRow]
        });

    } catch (e) {
        logger.error(`Remix command failed for ${input}`, e);
        await interaction.editReply({ content: `❌ **Remix Command Failed:** ${e.message || 'Unknown Error'}` });
    }
}
