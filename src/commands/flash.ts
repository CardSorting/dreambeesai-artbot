import { SlashCommandBuilder } from 'discord.js';
import { hivePersistence } from '../services/HivePersistence.js';
import { HiveSafety } from '../services/HiveSafety.js';
import { HiveProxyInteraction } from '../core/HiveUX.js';
import { Command, CommandContext } from '../models/index.js';
import { Logger } from '../core/Logger.js';

const logger = new Logger();
const MODEL_ID = 'zit-h100-v1';

/**
 * REFACTORED MONOLITHIC COMMAND: Flash
 * Near-instant generation with low latency logic.
 */
export const flash: Command = {
    data: new SlashCommandBuilder()
        .setName('flash')
        .setDescription('Generate an image instantly (Costs 2 Zaps)')
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
            cost: hivePersistence.calculateBatchCost(MODEL_ID, 4),
            prompt: rawPrompt,
            category: 'image-flash',
            task: async (signal: AbortSignal) => {
                // Offload to Collective Hive
                await engine.enqueueGeneration({
                    discordId: interaction.user.id,
                    interactionId: interaction.id,
                    prompt: rawPrompt,
                    modelId: MODEL_ID,
                    guildId: interaction.guildId
                });

                await interaction.reply({
                    content: `🐝 **Queued!** Your Flash request is being processed. Lightning strikes the hive!`,
                    ephemeral: true
                });
            }
        });
    }
};
