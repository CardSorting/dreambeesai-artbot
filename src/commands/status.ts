import { SlashCommandBuilder } from "discord.js";
import { hivePersistence } from "../services/HivePersistence.js";
import { HiveUX, HiveProxyInteraction } from "../core/HiveUX.js";
import { Command, CommandContext } from "../core/HiveEngine.js";
 * Displays the user's current Zap balance, streak, and reward availability.
 */
export const status: Command = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check your current DreamBees status and Zap balance'),
    category: 'utility',

    async execute(interaction: HiveProxyInteraction, context: CommandContext) {
        const { engine } = context;
        if (!engine) return;

        try {
            const user = await hivePersistence.getOrCreateUser(interaction.user.id, interaction.user.tag);
            const [claimStatus, isMember] = await Promise.all([
                hivePersistence.isDailyRewardAvailable(interaction.user.id),
                engine.isResiding(interaction.user.id)
            ]);

            const embed = HiveUX.createStatusEmbed(user, interaction.user.displayAvatarURL(), {
                isAvailable: claimStatus.available,
                nextReset: claimStatus.nextReset,
                isMember
            });

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (err: any) {
            await interaction.reply({ 
                content: `⚠️ **Hive Error:** Could not retrieve your status.`, 
                ephemeral: true 
            });
        }
    }
};
