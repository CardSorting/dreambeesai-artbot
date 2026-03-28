import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateDiscordUser } from '../lib/db/users.js';
import { db } from '../lib/firebase.js';
import { getRemoteConfig } from '../lib/db/config.js';
import { logger } from '../lib/logger.js';
import * as Hive from '../lib/hive.js';

export const category = 'utility';

export const data = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your current DreamBees Discord account status and Zap balance');

export async function execute(interaction) {
    const discordId = interaction.user.id;
    const discordTag = interaction.user.tag;

    try {
        // Fetch or Provision Discord User
        const userData = await getOrCreateDiscordUser(discordId, discordTag);
        if (!userData) {
            return interaction.reply({ content: '❌ **Error:** Could not load your profile. Please try again.', ephemeral: true });
        }

        // Fetch Remote Config for dynamic hints
        const config = await getRemoteConfig().catch(() => ({}));
        const baseReward = config.dailyRewardAmount || 100;

        // Check if daily reward is available
        const now = new Date();
        const dateId = `claim_${now.getUTCFullYear()}_${now.getUTCMonth() + 1}_${now.getUTCDate()}`;
        let isAvailable = true;
        try {
            const claimDoc = await db.collection('discord_users').doc(discordId).collection('claims').doc(dateId).get();
            isAvailable = !claimDoc.exists;
        } catch {
            // If we can't check, default to showing as available
        }

        // Safe joinedAt handling (Firestore Timestamp, JS Date, or string)
        const joinedAtRaw = userData.joinedAt;
        const joinedAtDate = joinedAtRaw?.toDate?.() || (joinedAtRaw instanceof Date ? joinedAtRaw : (joinedAtRaw ? new Date(joinedAtRaw) : null));
        const joinedAtField = joinedAtDate ? `<t:${Math.floor(joinedAtDate.getTime() / 1000)}:R>` : 'Just merged!';

        const statusEmbed = new EmbedBuilder()
            .setTitle('🐝 DreamBees Status')
            .setDescription('Welcome back to the hive! Here is your current standing in the swarm.')
            .setColor('#fbbf24') // Golden Bee
            .setThumbnail(interaction.user.displayAvatarURL())
            .addFields(
                { name: '🐝 Hive Resident', value: `@${discordTag}`, inline: true },
                { name: '🍯 Honey Jar', value: `**${(userData.zaps || 0).toFixed(1)}** Zaps`, inline: true },
                { name: '🌻 Pollination Streak', value: `**Day ${userData.claimStreak || 0}**`, inline: true },
                { name: '🕒 First Flight', value: joinedAtField, inline: true }
            );

        const isServerMember = await Hive.isResiding(interaction);

        if (!isServerMember) {
            statusEmbed.addFields({ name: '🎁 Daily Reward', value: `🔒 **Vaulted Reward!** Join the official **DreamBees server** to unlock your daily honey.\n🐝 [Join the Hive](${Hive.INVITE_LINK})`, inline: false });
        } else if (isAvailable) {
            statusEmbed.addFields({ name: '🎁 Daily Reward', value: `🟢 Available! Use \`/claim\` to get your ${baseReward} Zaps!`, inline: false });
        } else {
            const nextReset = new Date();
            nextReset.setUTCHours(24, 0, 0, 0);
            statusEmbed.addFields({ name: '🎁 Daily Reward', value: `🔴 Claimed. Resets <t:${Math.floor(nextReset.getTime() / 1000)}:R>`, inline: false });
        }

        statusEmbed.setFooter({ text: 'This account is independent from your DreamBees web profile.' });

        return interaction.reply({ embeds: [statusEmbed], ephemeral: true });
    } catch (err) {
        logger.error('Status command failed', err);
        return interaction.reply({ content: '❌ **Error:** Could not load your status. Please try again.', ephemeral: true }).catch(() => {});
    }
}
