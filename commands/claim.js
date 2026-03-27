import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Wallet } from '../lib/wallet.js';
import { logger } from '../lib/logger.js';
import { tryLock, releaseLock, setCooldown, getRemainingCooldown } from '../lib/db.js';
import { recordClaimMetrics } from '../lib/metrics.js';
import * as Hive from '../lib/hive.js';

export const category = 'utility';

export const data = new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim your daily 100 Zaps reward! 🐝');

export async function execute(interaction) {
    const startTime = Date.now();
    const discordId = interaction.user.id;
    const guildId = interaction.guildId;
    
    // 1. Server Membership Check (Exclusive to DreamBees)
    const isServerMember = await Hive.isResiding(interaction);

    if (!isServerMember) {
        return interaction.reply({ 
            content: Hive.Voice.restriction, 
            ephemeral: true 
        });
    }

    // 2. Rate Limiting (Spam Prevention)
    const cooldownMs = await getRemainingCooldown(discordId);
    if (cooldownMs > 0) {
        return interaction.reply({ 
            content: `⏳ **Slow down!** Please wait **${Math.ceil(cooldownMs / 1000)}s** before using this command again.`, 
            ephemeral: true 
        });
    }

    // 2. Concurrency Lock
    const lockAcquired = await tryLock(discordId);
    if (!lockAcquired) {
        return interaction.reply({ 
            content: `⚠️ **Processing...** Your last claim is still being finalized.`, 
            ephemeral: true 
        });
    }

    try {
        const result = await Wallet.claimDaily(discordId, { guildId });
        const successEmbed = new EmbedBuilder()
            .setTitle(result.bonusAmount > 0 ? `🌻 Pollination Bonus!` : `🍯 Honey Harvest Success!`)
            .setColor('#fbbf24') // Golden Bee
            .setDescription(result.bonusAmount > 0 
                ? `Incredible! Your **Day ${result.newStreak}** pollination streak earned you a **+${result.bonusAmount} Zap** bonus jar!`
                : `You've gathered your daily Zaps. Keep your streak alive to fill your jars with massive bonuses!`)
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/3062/3062331.png')
            .addFields(
                { name: '🍯 Fresh Honey', value: `**${result.rewardAmount}** Zaps`, inline: true },
                { name: '🌻 Streak', value: `**Day ${result.newStreak}**`, inline: true },
                { name: '🏦 Jar Balance', value: `**${result.newBalance.toFixed(1)}** Zaps`, inline: true },
                { name: '🕒 Next Harvest', value: `<t:${Math.floor(new Date().setUTCHours(24, 0, 0, 0) / 1000)}:R>`, inline: false }
            )
            .setFooter({ text: 'DreamBees Hive • Keep your wings fluttering!' })
            .setTimestamp();

        // 3. Telemetry & Cooldown
        await recordClaimMetrics({ 
            userId: discordId, 
            guildId,
            status: 'success', 
            streak: result.newStreak, 
            reward: result.rewardAmount,
            bonus: result.bonusAmount,
            durationMs: Date.now() - startTime 
        });
        await setCooldown(discordId, 60000); // 1 minute cooldown on success

        return interaction.reply({ embeds: [successEmbed] });

    } catch (err) {
        const isAlreadyClaimed = err.message.includes('already claimed');
        
        await recordClaimMetrics({ 
            userId: discordId, 
            guildId,
            status: isAlreadyClaimed ? 'rejected' : 'error', 
            error: err.message,
            durationMs: Date.now() - startTime 
        });

        // Still set a short cooldown on errors to prevent spamming the interaction
        await setCooldown(discordId, 15000);

        if (isAlreadyClaimed) {
            return interaction.reply({ 
                content: `⏳ **Already Harvested!** ${err.message}`, 
                ephemeral: true 
            });
        }
        
        logger.error(`Claim command failed for ${discordId}`, err);
        return interaction.reply({ 
            content: `❌ **Oops!** A swarm of bugs disrupted the claim. Please try again later.`, 
            ephemeral: true 
        });
    } finally {
        await releaseLock(discordId);
    }
}
