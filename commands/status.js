import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateDiscordUser } from '../lib/db.js';

export const category = 'utility';

export const data = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your current DreamBees Discord account status and Zap balance');

export async function execute(interaction) {
    const discordId = interaction.user.id;
    const discordTag = interaction.user.tag;

    // Fetch or Provision Discord User
    const userData = await getOrCreateDiscordUser(discordId, discordTag);

    const statusEmbed = new EmbedBuilder()
        .setTitle('🐝 DreamBees Status')
        .setColor('#fbbf24') // Golden Bee
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
            { name: '👤 Identity', value: `@${discordTag}`, inline: true },
            { name: '⚡ Zap Balance', value: `**${(userData.zaps || 0).toFixed(1)}** Zaps`, inline: true },
            { name: '📅 Joined', value: userData.joinedAt ? `<t:${Math.floor(userData.joinedAt.toDate().getTime() / 1000)}:R>` : 'Just merged!', inline: true }
        )
        .setFooter({ text: 'This account is independent from your DreamBees web profile.' });

    return interaction.reply({ embeds: [statusEmbed], ephemeral: true });
}
