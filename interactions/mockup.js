import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, AttachmentBuilder } from 'discord.js';
import { getGeneration, getUserByDiscordId } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { fetchWithTimeout, keepAliveAgent } from '../lib/api/dreambees.js';

export const customIdPrefix = 'mockup_';

const MOCKUP_COST = 0.50;
const GACHA_COST = 0.25;
const GRID_COST = 1.00;

const PRODUCTS = [
    { label: '💿 Vinyl Record', value: 'vinyl_record', description: 'Classic 12" record sleeve' },
    { label: '🛋️ Throw Pillow', value: 'pillow', description: 'Square decorative pillow' },
    { label: '👕 Standard T-Shirt', value: 'tshirt_screenprint', description: 'Heavyweight cotton tee' },
    { label: '🏷️ Die-Cut Sticker', value: 'sticker_diecut', description: 'Vinyl sticker with border' },
    { label: '☕ Ceramic Mug', value: 'mug_ceramic', description: 'Classic coffee mug' },
    { label: '👜 Tote Bag', value: 'tote_bag', description: 'Natural canvas bag' },
    { label: '📱 Phone Case', value: 'phone_case', description: 'Hard plastic case' },
    { label: '🛹 Skateboard Deck', value: 'skateboard', description: 'Deck bottom graphic' },
    { label: '🎴 Poke-Style Holo', value: 'tcg_pokemon', description: 'Holographic monster card' },
    { label: '🪄 Fantasy TCG', value: 'tcg_magic', description: 'Vintage fantasy card' },
    { label: '🎴 Duel Monster', value: 'tcg_yugioh', description: 'Anime style card' },
    { label: '🥤 Soda Can', value: 'soda_can', description: 'Aluminum can with condensation' },
    { label: '📦 Shipping Box', value: 'shipping_box', description: 'Cardboard delivery box' },
    { label: '🧴 Cosmetic Tube', value: 'cosmetic_tube', description: 'Squeeze tube packaging' },
    { label: '🖼️ Wall Poster', value: 'poster', description: 'Large vertical print' }
];

const ENVIRONMENTS = [
    { label: '✨ Clean Studio', value: 'studio', description: 'Minimalist white background' },
    { label: '💎 Luxury Marble', value: 'marble', description: 'Polished stone surface' },
    { label: '🌿 Dynamic Shadows', value: 'shadow_play', description: 'Artistic palm leaf shadows' },
    { label: '🎮 The Shrine', value: 'otaku_room', description: 'Cozy gamer desk' },
    { label: '🏫 Classroom', value: 'school_desk', description: 'Nostalgic slice-of-life' },
    { label: '🏮 Akiba Night', value: 'akiba_night', description: 'Neon city vibe' },
    { label: '🪵 Wood Table', value: 'wood', description: 'Warm oak surface' },
    { label: '☕ Cafe Vibe', value: 'cafe', description: 'Cozy coffee shop' },
    { label: '🌴 Beach Scene', value: 'beach', description: 'Golden sand & ocean' },
    { label: '🏭 Industrial', value: 'industrial', description: 'Raw concrete & moody' },
    { label: '📸 Retro Polaroid', value: 'retro', description: 'Vintage film aesthetic' }
];

export async function execute(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const originalInteractionId = parts[2];
    const imageIndex = parseInt(parts[3], 10);

    try {
        if (action === 'studio') {
            return handleShowStudio(interaction, originalInteractionId, imageIndex);
        } else if (action === 'gacha') {
            return handleGacha(interaction, originalInteractionId, imageIndex);
        } else if (action === 'select-product') {
            const productId = interaction.values[0];
            return handleShowEnvironments(interaction, originalInteractionId, imageIndex, productId);
        } else if (action === 'select-env') {
            const [productId, envId] = interaction.values[0].split(':');
            return handleGenerateMockup(interaction, originalInteractionId, imageIndex, productId, envId);
        } else if (action === 'redo') {
            const [productId, envId] = parts.slice(4).join('_').split(':');
            return handleGenerateMockup(interaction, originalInteractionId, imageIndex, productId, envId);
        } else if (action === 'changevibe') {
            const productId = parts.slice(4).join('_');
            return handleShowEnvironments(interaction, originalInteractionId, imageIndex, productId);
        } else if (action === 'grid') {
            const productId = parts.slice(4).join('_');
            return handleGenerateGrid(interaction, originalInteractionId, imageIndex, productId);
        } else if (action === 'cancel') {
            return interaction.update({ content: '🚫 Mockup Studio closed.', embeds: [], components: [] });
        } else {
            return interaction.reply({ content: '❌ Invalid mockup action.', ephemeral: true });
        }
    } catch (e) {
        logger.error(`Mockup Studio Error: ${interaction.customId}`, e);
        const errContent = { content: `❌ **Studio Error:** ${e.message}`, ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.editReply(errContent).catch(() => {});
        else await interaction.reply(errContent).catch(() => {});
    }
}

async function handleShowStudio(interaction, originalInteractionId, imageIndex) {
    const userData = await getUserByDiscordId(interaction.user.id);
    const generationData = await getGeneration(originalInteractionId);

    if (!generationData) return interaction.reply({ content: '❌ Data expired.', ephemeral: true });

    const embed = new EmbedBuilder()
        .setTitle('📽️ DreamBees Mockup Studio')
        .setDescription(`Professional product visualization loop.\n\n**Custom Render:** ${MOCKUP_COST} Zaps\n**Mockup Gacha:** ${GACHA_COST} Zaps\n**Elite 4-Grid:** ${GRID_COST} Zaps`)
        .setColor('#facc15')
        .setThumbnail(generationData.urls[imageIndex]);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`mockup_select-product_${originalInteractionId}_${imageIndex}`)
        .setPlaceholder('Step 1: Choose a Product Base...')
        .addOptions(PRODUCTS.slice(0, 25));

    const row1 = new ActionRowBuilder().addComponents(selectMenu);
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`mockup_gacha_${originalInteractionId}_${imageIndex}`)
            .setLabel('Mockup Gacha 🎰')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!userData || (userData.zaps || 0) < GACHA_COST),
        new ButtonBuilder()
            .setCustomId(`mockup_cancel_${originalInteractionId}_${imageIndex}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Secondary)
    );

    const replyPayload = { embeds: [embed], components: [row1, row2], ephemeral: true };
    if (interaction.isButton() || interaction.isStringSelectMenu()) await interaction.update(replyPayload);
    else await interaction.reply(replyPayload);
}

async function handleShowEnvironments(interaction, originalInteractionId, imageIndex, productId) {
    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.update({ content: '❌ Data expired.', components: [] });

    const product = PRODUCTS.find(p => p.value === productId);

    const embed = new EmbedBuilder()
        .setTitle(`🎨 Lighting & Atmosphere: ${product.label}`)
        .setDescription(`Assign an environment to your **${product.label}**.`)
        .setColor('#facc15')
        .setThumbnail(generationData.urls[imageIndex]);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`mockup_select-env_${originalInteractionId}_${imageIndex}`)
        .setPlaceholder('Step 2: Choose a Lighting Set...')
        .addOptions(ENVIRONMENTS.map(env => ({
            label: env.label,
            value: `${productId}:${env.value}`,
            description: env.description
        })));

    const row1 = new ActionRowBuilder().addComponents(selectMenu);
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`mockup_studio_${originalInteractionId}_${imageIndex}`)
            .setLabel('Back to Products')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`mockup_grid_${originalInteractionId}_${imageIndex}_${productId}`)
            .setLabel('Generate 4-Grid 🪄')
            .setStyle(ButtonStyle.Success)
    );

    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

async function handleGenerateMockup(interaction, originalInteractionId, imageIndex, itemId, envId) {
    await interaction.deferUpdate();
    const generationData = await getGeneration(originalInteractionId);
    const dreambeesUid = generationData.dreambeesUid;

    const product = PRODUCTS.find(p => p.value === itemId);
    const env = ENVIRONMENTS.find(e => e.value === envId);

    await interaction.editReply({ 
        content: `✨ **Alchemist at work...** Rendering **${product.label}** with **${env.label}** lighting via Vertex AI Imagen 006.`,
        embeds: [], components: [] 
    });

    try {
        const imageRes = await fetchWithTimeout(generationData.urls[imageIndex], { agent: keepAliveAgent }, 15000);
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        const base64Image = `data:image/png;base64,${buffer.toString('base64')}`;

        const apiResponse = await fetchWithTimeout(process.env.DREAMBEES_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": process.env.DREAMBEES_API_KEY },
            body: JSON.stringify({
                data: {
                    action: "generateMockupItem",
                    image: base64Image,
                    itemId: itemId,
                    presetId: envId,
                    targetUserId: dreambeesUid,
                    requestId: `mockup_${interaction.id}`
                }
            }),
            agent: keepAliveAgent
        }, 60000);

        const { result } = await apiResponse.json();
        
        const embed = new EmbedBuilder()
            .setTitle(`✨ ${product.label} • ${env.label}`)
            .setDescription(`Your professional render is complete. Credits deducted from your Soul Zaps balance. ${dreambeesUid ? '\n\n✅ **Saved to your collection!**' : ''}`)
            .setImage(result.url)
            .setColor('#7289da')
            .setFooter({ text: 'DreamBees Alchemist • Universal Mockup Studio' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mockup_redo_${originalInteractionId}_${imageIndex}_${itemId}:${envId}`)
                .setLabel('🔄 Regenerate')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`mockup_changevibe_${originalInteractionId}_${imageIndex}_${itemId}`)
                .setLabel('🎭 Change Vibe')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`mockup_grid_${originalInteractionId}_${imageIndex}_${itemId}`)
                .setLabel('🪄 Elite 4-Grid')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`mockup_studio_${originalInteractionId}_${imageIndex}`)
                .setLabel('🏠 Home')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ content: '', embeds: [embed], components: [row] });
    } catch (e) {
        await interaction.editReply({ content: `❌ **Render Failed:** ${e.message}`, components: [] });
    }
}

async function handleGenerateGrid(interaction, originalInteractionId, imageIndex, itemId) {
    await interaction.deferUpdate();
    const generationData = await getGeneration(originalInteractionId);
    const dreambeesUid = generationData.dreambeesUid;

    const product = PRODUCTS.find(p => p.value === itemId);
    const chosenEnvs = ENVIRONMENTS.slice(0, 4).map(e => e.value);

    await interaction.editReply({ 
        content: `🪄 **Generating Elite 4-Grid...** Creating 4 distinct high-fidelity environments for your **${product.label}**.`,
        embeds: [], components: [] 
    });

    try {
        const imageRes = await fetchWithTimeout(generationData.urls[imageIndex], { agent: keepAliveAgent }, 15000);
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        const base64Image = `data:image/png;base64,${buffer.toString('base64')}`;

        const apiResponse = await fetchWithTimeout(process.env.DREAMBEES_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": process.env.DREAMBEES_API_KEY },
            body: JSON.stringify({
                data: {
                    action: "generateMockupGrid",
                    image: base64Image,
                    itemId: itemId,
                    presetIds: chosenEnvs,
                    targetUserId: dreambeesUid,
                    requestId: `grid_${interaction.id}`
                }
            }),
            agent: keepAliveAgent
        }, 80000); // Longer timeout for grid

        const { result } = await apiResponse.json();
        
        // Construct the grid response (Multiple images)
        const embed = new EmbedBuilder()
            .setTitle(`🪄 Elite 4-Grid: ${product.label}`)
            .setDescription(`Generated with **Studio**, **Marble**, **Shadow Play**, and **Otaku Room** environments.`)
            .setColor('#facc15');

        // Note: For now, I'll just show the first one and provide links for all 4
        embed.setImage(result.urls[0]);

        const row = new ActionRowBuilder().addComponents(
             new ButtonBuilder()
                .setCustomId(`mockup_changevibe_${originalInteractionId}_${imageIndex}_${itemId}`)
                .setLabel('🎭 Pick Specific Vibe')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`mockup_studio_${originalInteractionId}_${imageIndex}`)
                .setLabel('🏠 Studio Home')
                .setStyle(ButtonStyle.Secondary)
        );

        const linksRow = new ActionRowBuilder();
        result.urls.forEach((url, i) => {
             linksRow.addComponents(new ButtonBuilder().setLabel(`Env ${i+1}`).setStyle(ButtonStyle.Link).setURL(url));
        });

        await interaction.editReply({ content: '', embeds: [embed], components: [linksRow, row] });
    } catch (e) {
        await interaction.editReply({ content: `❌ **Grid Failed:** ${e.message}`, components: [] });
    }
}

async function handleGacha(interaction, originalInteractionId, imageIndex) {
    await interaction.deferUpdate();
    const generationData = await getGeneration(originalInteractionId);
    const dreambeesUid = generationData.dreambeesUid;

    await interaction.editReply({ 
        content: `🎰 **Spinning the Gacha...** May the Alchemist favor you!`,
        embeds: [], components: [] 
    });

    try {
        const imageRes = await fetchWithTimeout(generationData.urls[imageIndex], { agent: keepAliveAgent }, 15000);
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        const base64Image = `data:image/png;base64,${buffer.toString('base64')}`;

        const apiResponse = await fetchWithTimeout(process.env.DREAMBEES_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": process.env.DREAMBEES_API_KEY },
            body: JSON.stringify({
                data: {
                    action: "gachaSpin",
                    image: base64Image,
                    targetUserId: dreambeesUid,
                    requestId: `gacha_${interaction.id}`
                }
            }),
            agent: keepAliveAgent
        }, 60000);

        const { result } = await apiResponse.json();
        
        const embed = new EmbedBuilder()
            .setTitle(`🎰 Gacha Win: ${result.item.label}`)
            .setDescription(`You pulled a **${result.item.label}** in **${result.preset.label}**! ${dreambeesUid ? '\n\n✅ **Saved to your collection!**' : ''}`)
            .setImage(result.url)
            .setColor('#facc15');

        const row = new ActionRowBuilder().addComponents(
             new ButtonBuilder()
                .setCustomId(`mockup_gacha_${originalInteractionId}_${imageIndex}`)
                .setLabel('Spin Again? 🎰')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`mockup_studio_${originalInteractionId}_${imageIndex}`)
                .setLabel('🏠 Studio')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ content: '', embeds: [embed], components: [row] });
    } catch (e) {
        await interaction.editReply({ content: `❌ **Gacha Failed:** ${e.message}`, components: [] });
    }
}
