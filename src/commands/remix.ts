import { SlashCommandBuilder } from "discord.js";
import { hivePersistence } from "../services/HivePersistence.js";
import { HiveUX, HiveProxyInteraction } from "../core/HiveUX.js";
import { Command, CommandContext } from "../core/HiveEngine.js";
/**
 * Universal image evolution via URL or ID.
 */
export const remix: Command = {
    data: new SlashCommandBuilder()
        .setName('remix')
        .setDescription('💡 Universal Remix: Evolve any image via URL or ID')
        .addStringOption(option => 
            option.setName('input')
                .setDescription('Image URL or DreamBees Image ID')
                .setRequired(true)),
    category: 'image',

    async execute(interaction: HiveProxyInteraction, context: CommandContext) {
        const { engine } = context;
        if (!engine) return;

        await interaction.defer({ ephemeral: true });

        try {
            const input = (interaction.interaction as any).options.getString('input').trim();
            const discordId = interaction.user.id;
            
            let imageUrl = '';
            let prompt = 'Imported for Remix';
            let imageId = 'external';

            // 1. Resolve Input
            if (input.startsWith('http')) {
                imageUrl = input;
            } else {
                // Pillar 2: Engine (API Integration)
                const detail = await engine.fetchImageDetail(input);
                if (detail) {
                    imageUrl = detail.imageUrl;
                    prompt = detail.prompt;
                    imageId = input;
                } else {
                    return await interaction.reply({ content: `❌ Could not find Image ID: \`${input}\`.` });
                }
            }

            // 2. Pillar 1: Persistence (Save Virtual Generation)
            const interactionId = `remix_ext_${interaction.id}`;
            await hivePersistence.saveGeneration(interactionId, {
                prompt,
                modelId: "imported",
                userId: discordId,
                urls: [imageUrl],
                imageIds: [imageId],
                gridUrl: imageUrl,
                cost: 0
            });

            // 3. Pillar 4: UX (Studio UI)
            const ui = HiveUX.createRemixUI(imageUrl, prompt, interactionId);
            await interaction.reply(ui);

        } catch (err: any) {
            await interaction.reply({ content: `❌ **Remix Failed:** ${err.message}` });
        }
    }
};
