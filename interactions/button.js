import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { getGeneration } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { fetchWithTimeout, keepAliveAgent } from '../lib/api/dreambees.js';

export const customIdPrefix = 'upscale_';

export async function execute(interaction) {
    // Legacy link handler removed as accounts are now separate.
    if (interaction.customId.startsWith('upscale_link_account')) {
        return interaction.reply({ content: '🔗 **Syncing is no longer required.** Discord accounts are now standalone! Enjoy.', ephemeral: true });
    }

    const parts = interaction.customId.split('_');
    if (parts.length !== 3) {
        return interaction.reply({ content: 'Invalid button ID format.', ephemeral: true });
    }

    const originalInteractionId = parts[1];
    const imageIndex = parseInt(parts[2], 10);
    const signal = interaction.signal || (interaction.interaction?.signal);

    // Initial defer - must be ephemeral if we want subsequent edits to be ephemeral
    await interaction.deferReply({ ephemeral: true });

    try {
        const generationData = await getGeneration(originalInteractionId);

        if (!generationData || !generationData.urls || generationData.urls.length === 0) {
            return interaction.editReply({ content: 'Detailed image data could not be found. It may have expired.' });
        }

        if (imageIndex < 0 || imageIndex > 3 || !generationData.urls[imageIndex]) {
            return interaction.editReply({ content: 'Invalid image index or missing URL.' });
        }

        const imageUrl = generationData.urls[imageIndex];
        
        let imageRes;
        let retries = 3;
        while (retries > 0) {
            try {
                imageRes = await fetchWithTimeout(imageUrl, { agent: keepAliveAgent, signal }, 20000);
                if (imageRes.ok) break;
            } catch (fetchErr) {
                logger.warn(`Fetch attempt failed for upscale image`, { attempt: 4 - retries, error: fetchErr.message });
            }
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, 1000));
        }

        if (!imageRes || !imageRes.ok) throw new Error(`Failed to fetch image from S3 after retries: ${imageRes?.status}`);

        const singleImageBuffer = Buffer.from(await imageRes.arrayBuffer());
        const attachment = new AttachmentBuilder(singleImageBuffer, { name: `upscaled_${originalInteractionId.slice(-6)}_${imageIndex + 1}.webp` });
        
        const upscaleEmbed = new EmbedBuilder()
            .setTitle(`Upscale Complete (U${imageIndex + 1}) ✨`)
            .setColor('#fbbf24')
            .setDescription('✨ **Image retrieved successfully!** This generation is saved to your independent Discord history.')
            .setImage(`attachment://upscaled_${originalInteractionId.slice(-6)}_${imageIndex + 1}.webp`);

        const syncRow = new ActionRowBuilder();
        
        // --- MOCKUP STUDIO ---
        const mockupButton = new ButtonBuilder()
            .setCustomId(`mockup_studio_${originalInteractionId}_${imageIndex}`)
            .setLabel('Mockup Studio ✨')
            .setStyle(ButtonStyle.Success);

        // --- REMIX 💡 ---
        const remixButton = new ButtonBuilder()
            .setCustomId(`remix_upscale_${originalInteractionId}_${imageIndex}`)
            .setLabel('Remix 💡')
            .setStyle(ButtonStyle.Secondary);

        syncRow.addComponents(mockupButton, remixButton);

        const vibeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_cyberpunk`)
                .setLabel('Cyberpunk ⚡')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_studio`)
                .setLabel('Studio 📸')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_anime`)
                .setLabel('Anime 🌸')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`remix_vibe_${originalInteractionId}_${imageIndex}_dark`)
                .setLabel('Dark 🌑')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`remix_vibegrid_${originalInteractionId}_${imageIndex}`)
                .setLabel('Elite Vibe Grid 🎰')
                .setStyle(ButtonStyle.Success)
        );

        const toolsRow = new ActionRowBuilder().addComponents(
             new StringSelectMenuBuilder()
                .setCustomId(`remix_tools_${originalInteractionId}_${imageIndex}`)
                .setPlaceholder('🛠️ Advanced Remix Tools...')
                .addOptions([
                    {
                        label: 'Genius Ideas 🔮',
                        description: 'AI-generated creative directions for this image',
                        value: 'genius'
                    },
                    {
                        label: 'Subtle Edit (0.5) ⚡',
                        description: 'Preserve more of the original details',
                        value: 'strength_low'
                    },
                    {
                        label: 'Dramatic Edit (0.8) ⚡',
                        description: 'High creativity and transformation',
                        value: 'strength_high'
                    },
                    {
                        label: 'View Parent Image ⏳',
                        description: 'See the previous version in the chain',
                        value: 'history'
                    },
                    {
                        label: 'Focus: Subject 👤',
                        description: 'Surgical edit: Only change the subject',
                        value: 'focus_subject'
                    },
                    {
                        label: 'Focus: Environment 🌌',
                        description: 'Surgical edit: Only change the environment',
                        value: 'focus_environment'
                    },
                    {
                        label: 'Lock Style 🧪',
                        description: 'Extract and save this style for future remixes',
                        value: 'lock_style'
                    },
                    {
                        label: 'Explore Neighborhood 🧭',
                        description: 'Generate 4 variations with varying creativity levels',
                        value: 'explore_variations'
                    },
                    {
                        label: 'Generate Match 🌈',
                        description: 'Create a style-matched companion (pet, weapon, etc)',
                        value: 'generate_match'
                    },
                    {
                        label: 'View Evolution Mural ⏳',
                        description: 'See the full story from Root to Current',
                        value: 'view_mural'
                    },
                    {
                        label: 'Summon Prism 💎',
                        description: 'Project into Mythic, Chrome, Primal, & Gothic realms',
                        value: 'summon_prism'
                    }
                ])
        );

        await interaction.editReply({
            embeds: [upscaleEmbed],
            files: [attachment],
            components: [syncRow, vibeRow, toolsRow]
        });

        // --- Lightweight Attribution Sync (Push to Web App) ---
        const targetUserId = `discord:${interaction.user.id}`;

        if (generationData.imageIds && generationData.imageIds[imageIndex]) {
            const imageId = generationData.imageIds[imageIndex];
            
            // 1. Auto-Bookmark for the Discord Identity
            fetchWithTimeout(process.env.DREAMBEES_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": process.env.DREAMBEES_API_KEY },
                body: JSON.stringify({
                    data: {
                        action: "toggleBookmark",
                        imageId: imageId,
                        isBookmarked: false,
                        targetUserId: targetUserId,
                        targetDisplayName: interaction.user.tag,
                        targetPhotoURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                        imgData: {
                            imageUrl: imageUrl,
                            thumbnailUrl: imageUrl,
                            prompt: generationData.prompt,
                            aspectRatio: generationData.aspectRatio || "1:1"
                        }
                    }
                }),
                agent: keepAliveAgent
            }, 15000).catch(err => logger.error(`Upscale Bookmark Sync Failed`, err));

            // 2. Register to Global Feed
            fetchWithTimeout(process.env.DREAMBEES_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": process.env.DREAMBEES_API_KEY },
                body: JSON.stringify({
                    data: {
                        action: "registerDiscordUpscale",
                        imageUrl: imageUrl,
                        prompt: generationData.prompt,
                        modelId: generationData.modelId,
                        targetUserId: targetUserId,
                        targetDisplayName: interaction.user.tag,
                        targetPhotoURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                        requestId: `${originalInteractionId}_upscale`,
                        aspectRatio: generationData.aspectRatio || "1:1"
                    }
                }),
                agent: keepAliveAgent
            }, 15000).catch(err => logger.error(`Feed Sync Failed for ${imageId}`, err));
        }
    } catch (e) {
        logger.error(`Error in button interaction ${interaction.customId}`, e);
        const errorContent = `❌ An error occurred while retrieving the image. Error: ${e.message}`;
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorContent }).catch(() => {});
        } else {
            await interaction.reply({ content: errorContent, ephemeral: true }).catch(() => {});
        }
    }
}

