import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateDiscordUser, db, getRemoteConfig } from '../lib/db.js';

export const category = 'utility';

export const data = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your current DreamBees Discord account status and Zap balance');

export async function execute(interaction) {
    const discordId = interaction.user.id;
    const discordTag = interaction.user.tag;

    // Fetch or Provision Discord User
    const userData = await getOrCreateDiscordUser(discordId, discordTag);

    // Fetch Remote Config for dynamic hints
    const config = await getRemoteConfig();
    const baseReward = config.dailyRewardAmount || 100;

    // Check if daily reward is available
    const now = new Date();
    const dateId = `claim_${now.getUTCFullYear()}_${now.getUTCMonth() + 1}_${now.getUTCDate()}`;
    const claimDoc = await db.collection('discord_users').doc(discordId).collection('claims').doc(dateId).get();
    const isAvailable = !claimDoc.exists;

    const statusEmbed = new EmbedBuilder()
        .setTitle('🐝 DreamBees Status')
        .setDescription('Welcome back to the hive! Here is your current standing in the swarm.')
        .setColor('#fbbf24') // Golden Bee
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
            { name: '🐝 Hive Resident', value: `@${discordTag}`, inline: true },
            { name: '🍯 Honey Jar', value: `**${(userData.zaps || 0).toFixed(1)}** Zaps`, inline: true },
            { name: '🌻 Pollination Streak', value: `**Day ${userData.claimStreak || 0}**`, inline: true },
            { name: '🕒 First Flight', value: userData.joinedAt ? `<t:${Math.floor(userData.joinedAt.toDate().getTime() / 1000)}:R>` : 'Just merged!', inline: true }
        );

    const targetGuildId = process.env.DREAMBEES_GUILD_ID || '1275879277895745536';
    let isServerMember = interaction.guildId === targetGuildId;
    if (!isServerMember) {
        const guild = await interaction.client.guilds.fetch(targetGuildId).catch(() => null);
        if (guild) {
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (member) isServerMember = true;
        }
    }

    if (!isServerMember) {
        statusEmbed.addFields({ name: '🎁 Daily Reward', value: `🔒 **Vaulted Reward!** Join the official **DreamBees server** to unlock your daily honey.\n🐝 [Join the Hive](https://discord.com/invite/curMHRAN8y)`, inline: false });
    } else if (isAvailable) {
        statusEmbed.addFields({ name: '🎁 Daily Reward', value: `🟢 Available! Use \`/claim\` to get your ${baseReward} Zaps!`, inline: false });
    } else {
        const nextReset = new Date();
        nextReset.setUTCHours(24, 0, 0, 0);
        statusEmbed.addFields({ name: '🎁 Daily Reward', value: `🔴 Claimed. Resets <t:${Math.floor(nextReset.getTime() / 1000)}:R>`, inline: false });
    }

    statusEmbed.setFooter({ text: 'This account is independent from your DreamBees web profile.' });

    return interaction.reply({ embeds: [statusEmbed], ephemeral: true });
}
