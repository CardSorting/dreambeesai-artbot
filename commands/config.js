import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setGuildConfig, getGuildConfig } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export const category = 'admin';

export const data = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure community moderation settings for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
        option.setName('mod_channel')
            .setDescription('Channel where moderation reports will be sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addIntegerOption(option =>
        option.setName('threshold')
            .setDescription('Number of reports required to auto-hide a generation (default: 3)')
            .setMinValue(1)
            .setMaxValue(10));

export async function execute(interaction) {
    if (!interaction.guildId) {
        return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    }

    const modChannel = interaction.options.getChannel('mod_channel');
    const threshold = interaction.options.getInteger('threshold');

    const currentConfig = await getGuildConfig(interaction.guildId);
    const newConfig = { ...currentConfig };

    let summary = [];
    if (modChannel) {
        newConfig.modLogChannelId = modChannel.id;
        summary.push(`✅ **Moderator Log Channel**: <#${modChannel.id}>`);
    }

    if (threshold !== null && threshold !== undefined) {
        newConfig.reportThreshold = threshold;
        summary.push(`✅ **Auto-Hide Threshold**: ${threshold} reports`);
    }

    if (summary.length === 0) {
        return interaction.reply({ 
            content: `⚙️ **Current Configuration:**\n- Mod Log Channel: ${currentConfig.modLogChannelId ? `<#${currentConfig.modLogChannelId}>` : 'Not Set'}\n- Auto-Hide Threshold: **${currentConfig.reportThreshold || 3}**`, 
            ephemeral: true 
        });
    }

    try {
        await setGuildConfig(interaction.guildId, newConfig);
        logger.info(`Guild configuration updated for ${interaction.guildId}`, { actor: interaction.user.id, newConfig });
        
        return interaction.reply({ 
            content: `⚙️ **Configuration Updated!**\n\n${summary.join('\n')}`, 
            ephemeral: true 
        });
    } catch (err) {
        logger.error(`Failed to update guild config`, err);
        return interaction.reply({ content: '❌ **Error!** Failed to save configuration.', ephemeral: true });
    }
}
