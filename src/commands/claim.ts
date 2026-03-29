import { SlashCommandBuilder } from "discord.js";
import { hivePersistence } from "../services/HivePersistence.js";
import { HiveUX, HiveProxyInteraction, Voice } from "../core/HiveUX.js";
import { Command, CommandContext } from "../core/HiveEngine.js";
/**
 * Allows users to claim their daily Zap reward with streak tracking.
 */
export const claim: Command = {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claim your daily 100 Zaps reward! 🐝'),
    category: 'utility',

    async execute(interaction: HiveProxyInteraction, context: CommandContext) {
        const { engine } = context;
        if (!engine) return;

        // Pillar 1: Orchestration
        await engine.orchestrate(interaction, {
            category: 'claim',
            description: 'Daily Zap claiming',
            cost: 0,
            safetyDepth: 'NONE' // No prompt to check
        }, async (signal: AbortSignal) => {
            // Resident Check
            const isMember = await engine.isResiding(interaction.user.id);
            if (!isMember) {
                return await interaction.reply({ content: Voice.restriction, ephemeral: true });
            }

            try {
                const result = await hivePersistence.claimDaily(interaction.user.id, { 
                    guildId: interaction.guildId || 'DM' 
                });
                
                const embed = HiveUX.createClaimSuccessEmbed(result);
                await interaction.reply({ embeds: [embed] });
                await hivePersistence.setCooldown(interaction.user.id, 60000); 

            } catch (err: any) {
                if (err.message.includes('already claimed')) {
                    return await interaction.reply({ 
                        content: `⏳ **Already Harvested!** ${err.message}`, 
                        ephemeral: true 
                    });
                }
                throw err; // Let orchestrate handle other errors
            }
        });
    }
};
