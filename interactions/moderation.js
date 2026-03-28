import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { getGeneration, addReport } from '../lib/db/generations.js';
import { getGuildConfig } from '../lib/db/config.js';
import { logger } from '../lib/logger.js';

export const customIdPrefix = 'gen_';

/**
 * Handles moderation interactions (Delete, Report).
 */
export async function execute(interaction) {
    const parts = interaction.customId.split('_');
    if (parts.length < 3) {
        return interaction.reply({ content: '❌ **Invalid interaction ID.**', ephemeral: true });
    }

    const action = parts[1];
    const originalInteractionId = parts.slice(2).join('_');

    try {
        // Fetch dynamic guild configuration
        const guildConfig = await getGuildConfig(interaction.guildId);
        const autoHideThreshold = guildConfig?.reportThreshold || 3;
        const modLogChannelId = guildConfig?.modLogChannelId;

        if (action === 'delete') {
            const generationData = await getGeneration(originalInteractionId);
            
            if (!generationData) {
                return interaction.reply({ content: '❌ **Generation not found.** It may have already been deleted.', ephemeral: true });
            }

            // Authorization: Original requester OR anyone with ManageMessages permission
            const isOwner = generationData.userId === interaction.user.id;
            const isMod = interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages);

            if (!isOwner && !isMod) {
                return interaction.reply({ 
                    content: '❌ **Not Authorized!** Only the owner or a moderator can delete this.', 
                    ephemeral: true 
                });
            }

            try {
                if (!interaction.message) {
                    return interaction.reply({ content: '❌ **Message Already Deleted.**', ephemeral: true });
                }
                await interaction.message.delete();
                logger.info(`Message deleted via moderation request`, { 
                    interactionId: originalInteractionId, 
                    actorId: interaction.user.id,
                    isMod
                });
                // Acknowledge deletion silently if we haven't replied yet
                if (!interaction.replied) {
                    await interaction.reply({ content: '🗑️ **Deleted.**', ephemeral: true }).catch(() => {});
                }
            } catch (err) {
                logger.error(`Failed to delete message`, err);
                return interaction.reply({ content: '❌ **Error!** Could not delete the message.', ephemeral: true });
            }
        } else if (action === 'report') {
            const reportData = {
                interactionId: originalInteractionId,
                reportedBy: interaction.user.id,
                reportedByTag: interaction.user.tag,
                channelId: interaction.channelId,
                guildId: interaction.guildId
            };

            const reportCount = await addReport(originalInteractionId, reportData);
            logger.warn(`Generation reported. Count: ${reportCount}`, { interactionId: originalInteractionId, reporter: interaction.user.id });

            // 1. Notify the reporter
            await interaction.reply({ 
                content: `🚩 **Reported!** (${reportCount}/${autoHideThreshold})\nThank you. This generation has been flagged for review.`, 
                ephemeral: true 
            });

            // 2. Send to Moderator Log Channel
            if (modLogChannelId) {
                const logChannel = await interaction.client.channels.fetch(modLogChannelId).catch(() => null);
                if (logChannel) {
                    const generationData = await getGeneration(originalInteractionId);
                    const reportEmbed = new EmbedBuilder()
                        .setTitle('🚩 Generation Reported')
                        .setColor('#ff4757')
                        .addFields(
                            { name: 'Reporter', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                            { name: 'Reports', value: `**${reportCount}**`, inline: true },
                            { name: 'Prompt', value: generationData?.prompt || 'Unknown' },
                            { name: 'Channel', value: `<#${interaction.channelId}>` }
                        )
                        .setTimestamp();
                    
                    if (generationData?.urls?.[0]) {
                        reportEmbed.setThumbnail(generationData.urls[0]);
                    }

                    const modActions = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`gen_delete_${originalInteractionId}`)
                            .setLabel('Delete Content')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await logChannel.send({ embeds: [reportEmbed], components: [modActions] }).catch(e => logger.error("Failed to send mod log", e));
                }
            }

            // 3. Auto-Hide Check
            if (reportCount >= autoHideThreshold) {
                try {
                    await interaction.message.delete();
                    logger.info(`Message auto-hidden after reaching report threshold`, { interactionId: originalInteractionId, reportCount, threshold: autoHideThreshold });
                } catch (err) {
                    logger.error(`Failed to auto-delete after threshold`, err);
                }
            }
        }
    } catch (err) {
        logger.error(`Moderation interaction failed`, { action, originalInteractionId, error: err.message });
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ **Error!** Something went wrong.', ephemeral: true }).catch(() => {});
        }
    }
}
