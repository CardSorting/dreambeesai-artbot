import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, AttachmentBuilder } from 'discord.js';
import { getGeneration, getUserByDiscordId } from '../lib/db.js';
import sharp from 'sharp';
import { logger } from '../lib/logger.js';
import { fetchWithTimeout, keepAliveAgent, registerDiscordGrid } from '../lib/api/dreambees.js';
import { Wallet } from '../lib/wallet.js';
import * as Hive from '../lib/hive.js';
import { CONFIG } from '../lib/config-check.js';

export const customIdPrefix = 'mockup_';

const MOCKUP_COST = CONFIG.COSTS.MOCKUP;
const GACHA_COST = CONFIG.COSTS.GACHA;
const GRID_COST = CONFIG.COSTS.GRID;

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
    const dreambeesUid = generationData?.dreambeesUid || `discord:${interaction.user.id}`;

    const product = PRODUCTS.find(p => p.value === itemId);
    const env = ENVIRONMENTS.find(e => e.value === envId);

    // REAL FINANCIAL DEBIT
    const requestId = `mockup_${interaction.id}`;
    try {
        await Wallet.debit(interaction.user.id, MOCKUP_COST, requestId, { action: 'mockup_render', itemId, envId });
    } catch (err) {
        return interaction.editReply({ content: Hive.Voice.emptyJar(MOCKUP_COST, 0), components: [] });
    }

    const signal = interaction.signal || (interaction.interaction?.signal);

    await interaction.editReply({ 
        content: `✨ **Hive Worker at work...** Refining **${product.label}** with **${env.label}** nectar via Vertex AI.`,
        embeds: [], components: [] 
    });

    try {
        const imageRes = await fetchWithTimeout(generationData.urls[imageIndex], { agent: keepAliveAgent, signal }, 15000);
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
                    targetDisplayName: interaction.user.tag,
                    targetPhotoURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                    requestId: `mockup_${interaction.id}`
                }
            }),
            agent: keepAliveAgent
        }, 60000);

        const { result } = await apiResponse.json();
        
        const embed = new EmbedBuilder()
            .setTitle(`✨ ${product.label} • ${env.label}`)
            .setDescription(`Your professional honey-render is complete. Credits harvested from your **Honey Jar**. ${dreambeesUid ? '\n\n✅ **Saved to your Hive Collection!**' : ''}`)
            .setImage(result.url)
            .setColor('#fbbf24') // Golden Bee
            .setFooter({ text: 'DreamBees Hive • Universal Mockup Studio' });

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
    const dreambeesUid = generationData?.dreambeesUid || `discord:${interaction.user.id}`;

    const product = PRODUCTS.find(p => p.value === itemId);
    const chosenEnvs = ENVIRONMENTS.slice(0, 4).map(e => e.value);

    // REAL FINANCIAL DEBIT
    const requestId = `grid_${interaction.id}`;
    try {
        await Wallet.debit(interaction.user.id, GRID_COST, requestId, { action: 'mockup_grid', itemId });
    } catch (err) {
        return interaction.editReply({ content: Hive.Voice.emptyJar(GRID_COST, 0), components: [] });
    }

    await interaction.editReply({ 
        content: `🪄 **Generating Elite 4-Grid...** Creating 4 distinct high-fidelity environments for your **${product.label}**.`,
        embeds: [], components: [] 
    });

    try {
        const sourceRes = await fetchWithTimeout(generationData.urls[imageIndex], { agent: keepAliveAgent, signal: interaction.signal }, 15000);
        const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());
        const base64Image = `data:image/png;base64,${sourceBuffer.toString('base64')}`;

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
                    targetDisplayName: interaction.user.tag,
                    targetPhotoURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                    requestId: `grid_${interaction.id}`
                }
            }),
            agent: keepAliveAgent,
            signal: interaction.signal
        }, 80000);

        const { result } = await apiResponse.json();
        
        // CREATE PROFESSIONAL 2X2 COMPOSITE GRID
        const gridBuffers = await Promise.all(result.urls.map(async url => {
            const res = await fetchWithTimeout(url, { agent: keepAliveAgent }, 15000);
            return Buffer.from(await res.arrayBuffer());
        }));

        const compositeBuffer = await sharp({
            create: {
                width: 2048,
                height: 2048,
                channels: 3,
                background: { r: 18, g: 18, b: 18 }
            }
        })
        .composite([
            { input: await sharp(gridBuffers[0]).resize(1024, 1024).toBuffer(), left: 0, top: 0 },
            { input: await sharp(gridBuffers[1]).resize(1024, 1024).toBuffer(), left: 1024, top: 0 },
            { input: await sharp(gridBuffers[2]).resize(1024, 1024).toBuffer(), left: 0, top: 1024 },
            { input: await sharp(gridBuffers[3]).resize(1024, 1024).toBuffer(), left: 1024, top: 1024 }
        ])
        .jpeg({ quality: 90 })
        .toBuffer();

        const attachment = new AttachmentBuilder(compositeBuffer, { name: 'mockup-grid.jpg' });

        const embed = new EmbedBuilder()
            .setTitle(`🪄 Elite 4-Grid: ${product.label}`)
            .setDescription(`High-fidelity visualization across Studio, Marble, Shadow Play, and Otaku Room. Credits harvested from your **Honey Jar**.`)
            .setColor('#fbbf24') // Golden Bee
            .setImage('attachment://mockup-grid.jpg')
            .setFooter({ text: 'DreamBees Hive • Universal Mockup Studio' });

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

        await interaction.editReply({ 
            content: dreambeesUid ? '✅ **Saved to your collection!**' : '', 
            embeds: [embed], 
            files: [attachment],
            components: [row] 
        });
    } catch (e) {
        logger.error("Grid Rendering Failed", e);
        await interaction.editReply({ content: `❌ **Grid Failed:** ${e.message}`, components: [] });
    }
}

async function handleGacha(interaction, originalInteractionId, imageIndex) {
    await interaction.deferUpdate();
    const generationData = await getGeneration(originalInteractionId);
    const dreambeesUid = generationData?.dreambeesUid || `discord:${interaction.user.id}`;

    // REAL FINANCIAL DEBIT
    const requestId = `gacha_${interaction.id}`;
    try {
        await Wallet.debit(interaction.user.id, GACHA_COST, requestId, { action: 'mockup_gacha' });
    } catch (err) {
        return interaction.editReply({ content: Hive.Voice.emptyJar(GACHA_COST, 0), components: [] });
    }

    await interaction.editReply({ 
        content: `🎰 **Spinning the Gacha...** May the Queen favor you!`,
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
                    targetDisplayName: interaction.user.tag,
                    targetPhotoURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                    requestId: `gacha_${interaction.id}`
                }
            }),
            agent: keepAliveAgent,
            signal: interaction.signal
        }, 60000);

        const { result } = await apiResponse.json();
        
        const embed = new EmbedBuilder()
            .setTitle(`🎰 Gacha Win: ${result.item.label}`)
            .setDescription(`You pulled a **${result.item.label}** in **${result.preset.label}**! ${dreambeesUid ? '\n\n✅ **Saved to your Hive Collection!**' : ''}`)
            .setImage(result.url)
            .setColor('#fbbf24'); // Golden Bee

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
