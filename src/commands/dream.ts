import { SlashCommandBuilder } from 'discord.js';
import { hivePersistence } from '../services/HivePersistence.js';
import { HiveUX, HiveProxyInteraction } from '../core/HiveUX.js';
import { Command, CommandContext } from '../core/HiveEngine.js';
const MODEL_ID = 'wai-illustrious';

/**
 * REFACTORED MONOLITHIC COMMAND: Dream
 * The first command to fully adopt the 4-Pillar architecture.
 * Features: Automatic balance check, multi-layer safety, and unified UX.
 */
export const dream: Command = {
    data: new SlashCommandBuilder()
        .setName('dream')
        .setDescription('High-fidelity art generation')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Describe the image you want to generate')
                .setRequired(true)
                .setMaxLength(1000)),
    category: 'image',

    async execute(interaction: HiveProxyInteraction, context: CommandContext) {
        const { engine } = context;
        const rawPrompt = (interaction.interaction as any).options.getString('prompt');
        
        await interaction.defer({ ephemeral: true });

        await engine.orchestrate(interaction, {
            category: 'image',
            description: 'High-fidelity art generation',
            cost: hivePersistence.calculateBatchCost(MODEL_ID, 4),
            prompt: rawPrompt,
            retryLimit: 3
        }, async (signal: AbortSignal) => {
            // Offload to Collective Hive
            await engine.enqueueGeneration({
                discordId: interaction.user.id,
                interactionId: interaction.id,
                channelId: interaction.channel!.id,
                prompt: rawPrompt,
                modelId: MODEL_ID,
                guildId: interaction.guildId,
                createdAt: Date.now()
            });

            await interaction.reply({
                content: `🐝 **Queued!** Offloaded to the Collective Hive. Your art is being harvested.`,
                ephemeral: true
            });
        });
    }
};
