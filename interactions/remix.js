import { ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db } from '../lib/firebase.js';
import { getGeneration, saveGeneration } from '../lib/db/generations.js';
import { getUserByDiscordId } from '../lib/db/users.js';
import { logger } from '../lib/logger.js';
import { fetchWithTimeout, keepAliveAgent } from '../lib/api/dreambees.js';
import { stitchImages, validateImageBuffer, stitchSideBySide, stitchNarrativeStrip } from '../lib/image-processor.js';
import { uploadToS3 } from '../lib/s3.js';
import { Wallet } from '../lib/wallet.js';
import * as Hive from '../lib/hive.js';
import { CONFIG } from '../lib/config-check.js';
import { wrapInAegis } from '../lib/safety-utils.js';

export const customIdPrefix = 'remix_';

const VIBE_INSTRUCTIONS = {
    cyberpunk: "apply a cyberpunk aesthetic with neon lights, futuristic cityscape elements, and a high-tech atmosphere",
    studio: "apply professional studio lighting, clean minimalist background, and high-fashion commercial aesthetic",
    anime: "transform into a high-quality hand-drawn anime style, vibrant colors, expressive line work, and cel-shading",
    dark: "apply a moody, dark, and atmospheric theme with deep shadows, cinematic lighting, and a mysterious vibe"
};

const PRISM_INSTRUCTIONS = {
    mythic: "project into the Mythic Realm: aetheric magic, celestial energy, and divine artifacts",
    chrome: "project into the Chrome Realm: cybernetic enhancements, neon circuitry, and high-tech dystopia",
    primal: "project into the Primal Realm: overgrown flora, ancient stone, and raw natural power",
    gothic: "project into the Gothic Realm: shattered shadows, Victorian macabre, and obsidian elegance"
};

const REMIX_COST = CONFIG.COSTS.REMIX || 0.50;
const PRISM_COST = CONFIG.COSTS.PRISM || 1.50;
const VARIATION_COST = CONFIG.COSTS.VARIATION || 1.50;
const MATCH_COST = CONFIG.COSTS.MATCH || 0.50;

export async function execute(interaction, options = {}) {
    const { logger: ctxLogger = logger } = options;
    const parts = interaction.customId.split('_');
    const action = parts[1]; // 'upscale', 'vibe', 'vibegrid', or 'tools'
    const originalInteractionId = parts[2];
    const imageIndex = parseInt(parts[3], 10);
    const vibeId = parts[4]; 

    const ctx = { logger: ctxLogger, signal: interaction.signal || (interaction.interaction?.signal) };

    if (action === 'upscale' && interaction.isButton()) {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.75, 'all', ctx);
    } else if (action === 'upscale' && interaction.isModalSubmit()) {
        const instructions = interaction.fields.getTextInputValue('instructions');
        const strength = interaction.customId.includes('_str_') ? parseFloat(interaction.customId.split('_str_')[1]) : 0.75;
        await handleRemixProcess(interaction, originalInteractionId, imageIndex, instructions, { strength, ...ctx });
    } else if (action === 'vibe') {
        const instructions = VIBE_INSTRUCTIONS[vibeId];
        await handleRemixProcess(interaction, originalInteractionId, imageIndex, instructions, ctx);
    } else if (action === 'vibegrid') {
        await handleEliteVibeGrid(interaction, originalInteractionId, imageIndex, ctx);
    } else if (action === 'tools' && interaction.isStringSelectMenu()) {
        await handleRemixTools(interaction, originalInteractionId, imageIndex, ctx);
    } else if (action === 'genius' && interaction.isButton()) {
        const instruction = parts[4]; 
        await handleRemixProcess(interaction, originalInteractionId, imageIndex, instruction, ctx);
    } else if (action === 'match' && interaction.isModalSubmit()) {
        const instructions = interaction.fields.getTextInputValue('instructions');
        await handleGenerateMatchProcess(interaction, originalInteractionId, imageIndex, instructions, ctx);
    }
}

async function handleRemixTools(interaction, originalInteractionId, imageIndex, ctx) {
    const choice = interaction.values[0];
    
    if (choice === 'genius') {
        await handleGeniusSuggestions(interaction, originalInteractionId, imageIndex, ctx);
    } else if (choice === 'strength_low') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.5, 'all', ctx);
    } else if (choice === 'strength_high') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.9, 'all', ctx);
    } else if (choice === 'history') {
        await handleViewParent(interaction, originalInteractionId, imageIndex, ctx);
    } else if (choice === 'focus_subject') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.75, 'subject', ctx);
    } else if (choice === 'focus_environment') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.75, 'environment', ctx);
    } else if (choice === 'lock_style') {
        await handleLockStyle(interaction, originalInteractionId, imageIndex, ctx);
    } else if (choice === 'explore_variations') {
        await handleExploreVariations(interaction, originalInteractionId, imageIndex, ctx);
    } else if (choice === 'generate_match') {
        await handleShowMatchModal(interaction, originalInteractionId, imageIndex, ctx);
    } else if (choice === 'view_mural') {
        await handleViewMural(interaction, originalInteractionId, imageIndex, ctx);
    } else if (choice === 'summon_prism') {
        await handleSummonPrism(interaction, originalInteractionId, imageIndex, ctx);
    }
}

async function handleSummonPrism(interaction, originalInteractionId, imageIndex, ctx) {
    const { logger: ctxLogger = logger } = ctx;
    await interaction.deferReply({ ephemeral: true });
    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Data not found.' });

    const userProfile = await getUserByDiscordId(interaction.user.id);
    if (!userProfile) return interaction.editReply({ content: '❌ Account linking required.' });

    // REAL FINANCIAL DEBIT
    const requestId = `prism_${interaction.id}`;
    try {
        await Wallet.debit(interaction.user.id, PRISM_COST, requestId, { action: 'prism_render' });
    } catch (err) {
        return interaction.editReply({ content: Hive.Voice.emptyJar(PRISM_COST, userProfile.zaps || 0) });
    }

    await interaction.editReply({ content: '💎 **Summoning the Prism...** Splitting the vision into 4 divergent dimensions.' });

    try {
        const dimensions = Object.keys(PRISM_INSTRUCTIONS);
        const results = await Promise.all(dimensions.map(d => generateRemix(generationData, imageIndex, PRISM_INSTRUCTIONS[d], userProfile.uid, interaction, { ...ctx })));

        await interaction.editReply({ content: '🪄 **Fracturing Reality...**' });

        const buffers = results.map(r => r.buffer);
        const gridBuffer = await stitchImages(buffers);
        
        const gridFilename = `remix-prism/${interaction.id}.webp`;
        await uploadToS3(gridFilename, gridBuffer);

        const embed = new EmbedBuilder()
            .setTitle('💎 The Prism of Dimensions')
            .setDescription(`Conceptual multi-realm projections:\n✨ **Mythic** • **Chrome** • **Primal** • **Gothic**\n\nChoose the destination for your next evolution.`)
            .setColor('#6366f1')
            .setImage('attachment://prism.png');

        await interaction.editReply({
            content: '', embeds: [embed],
            files: [new AttachmentBuilder(gridBuffer, { name: 'prism.png' })]
        });

    } catch (e) {
        ctxLogger.error(`Prism failed`, e);
        await interaction.editReply({ content: `❌ **Prism Failed:** ${e.message}` });
    }
}

async function handleShowMatchModal(interaction, originalInteractionId, imageIndex) {
    const modal = new ModalBuilder()
        .setCustomId(`remix_match_${originalInteractionId}_${imageIndex}`)
        .setTitle(`Visual DNA Match 🌈`);

    const instructionInput = new TextInputBuilder()
        .setCustomId('instructions')
        .setLabel('New Subject (Matched Style)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. "His dragon pet" or "Her magic staff"')
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(instructionInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

async function handleGenerateMatchProcess(interaction, originalInteractionId, imageIndex, instructions, ctx) {
    const { logger: ctxLogger = logger, signal } = ctx;
    await interaction.deferReply({ ephemeral: true });
    
    // 1. Safety Guard
    const isSafe = await Hive.guardHive(instructions, { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag, 
        guildId: interaction.guildId 
    });

    if (!isSafe) {
        ctxLogger.warn(`Unsafe match instruction rejected`, { instructions });
        return interaction.editReply({ content: Hive.Voice.safety });
    }

    // 2. Fetch User Profile
    const userProfile = await getUserByDiscordId(interaction.user.id);
    if (!userProfile) return interaction.editReply({ content: '❌ Account linking required.' });
    
    const styleMimic = userProfile.currentStyleMimic;

    const generationData = await getGeneration(originalInteractionId);

    // REAL FINANCIAL DEBIT
    const requestId = `match_${interaction.id}`;
    try {
        await Wallet.debit(interaction.user.id, MATCH_COST, requestId, { action: 'dna_match' });
    } catch (err) {
        return interaction.editReply({ content: Hive.Voice.emptyJar(MATCH_COST, userProfile.zaps || 0) });
    }

    await interaction.editReply({ content: '🌈 **Extracting Visual DNA...** Preparing to manifest a matched companion.' });

    try {
        const result = await generateRemix(generationData, imageIndex, instructions, userProfile.uid, interaction, {
            strength: 1.0, 
            styleMimic,
            ...ctx
        });

        const embed = new EmbedBuilder()
            .setTitle('🌈 Visual DNA Match: Manifestation Complete')
            .setDescription(`**Subject:** ${instructions}\n**Style Seed:** \`${styleMimic?.imageId || 'Current'}\`\n\n✨ This creation shares the identical aesthetic essence of your original work.`)
            .setColor('#a855f7')
            .setImage(result.imageUrl);

        await interaction.editReply({ content: '', embeds: [embed] });
    } catch (e) {
        ctxLogger.error('Match failed', e);
        await interaction.editReply({ content: `❌ **Match Failed:** ${e.message}` });
    }
}

async function handleViewMural(interaction, originalInteractionId, imageIndex, ctx) {
    const { logger: ctxLogger = logger, signal } = ctx;
    await interaction.deferReply({ ephemeral: true });
    const current = await getGeneration(originalInteractionId);
    if (!current) return interaction.editReply({ content: "❌ Current generation not found." });

    await interaction.editReply({ content: "⏳ **Gathering Ancestral Memories...** Stashing the narrative history." });

    try {
        const ancestralIds = [];
        if (current.rootImageId) ancestralIds.push(current.rootImageId);
        if (current.parentImageId && current.parentImageId !== current.rootImageId) ancestralIds.push(current.parentImageId);
        
        // Fetch Image URLs from backend
        const API_URL = process.env.DREAMBEES_API_URL;
        const API_KEY = process.env.DREAMBEES_API_KEY;

        const urlBuffers = [];
        // [Root, Parent, Current]
        const order = [current.rootImageId, current.parentImageId, current.imageIds[imageIndex]].filter(id => id && id !== 'external');
        const uniqueOrder = [...new Set(order)];

        for (const id of uniqueOrder) {
            const res = await fetchWithTimeout(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
                body: JSON.stringify({ data: { action: "getImageDetail", imageId: id } }),
                agent: keepAliveAgent,
                signal
            }, 10000);
            const { result } = await res.json();
            const imgRes = await fetchWithTimeout(result.imageUrl, { agent: keepAliveAgent, signal }, 15000);
            urlBuffers.push(Buffer.from(await imgRes.arrayBuffer()));
        }

        await interaction.editReply({ content: "🎨 **Comping the Lineage Mural...**" });

        const muralBuffer = await stitchNarrativeStrip(urlBuffers);
        
        const embed = new EmbedBuilder()
             .setTitle('⏳ The Lineage Mural')
             .setDescription(`A 3-stage narrative of your creative evolution.\n\n✨ **Start** (Left) ➔ **Parent** (Middle) ➔ **Apex** (Right)`)
             .setColor('#facc15')
             .setImage('attachment://mural.png');

        await interaction.editReply({
            content: '', embeds: [embed],
            files: [new AttachmentBuilder(muralBuffer, { name: 'mural.png' })]
        });
    } catch (e) {
        ctxLogger.error("Mural failed", e);
        await interaction.editReply({ content: "❌ Failed to weave the Lineage Mural." });
    }
}

async function handleExploreVariations(interaction, originalInteractionId, imageIndex, ctx) {
    const { logger: ctxLogger = logger } = ctx;
    await interaction.deferReply({ ephemeral: true });
    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Data not found.' });

    const userProfile = await getUserByDiscordId(interaction.user.id);
    if (!userProfile) return interaction.editReply({ content: '❌ Account linking required.' });

    // REAL FINANCIAL DEBIT
    const requestId = `variations_${interaction.id}`;
    try {
        await Wallet.debit(interaction.user.id, VARIATION_COST, requestId, { action: 'exploration' });
    } catch (err) {
        return interaction.editReply({ content: Hive.Voice.emptyJar(VARIATION_COST, userProfile.zaps || 0) });
    }

    await interaction.editReply({ content: '🧭 **Exploring the Neighborhood...** Probing 4 creative levels simultaneously.' });

    try {
        const strengths = [0.5, 0.65, 0.8, 0.95];
        const results = await Promise.all(strengths.map(s => generateRemix(generationData, imageIndex, "Refine and enhance this concept with varying degrees of creativity", userProfile.uid, interaction, { strength: s, ...ctx })));

        await interaction.editReply({ content: '🪄 **Stitching Astral Variations...**' });

        const buffers = results.map(r => r.buffer);
        const gridBuffer = await stitchImages(buffers);
        
        const gridFilename = `remix-variations/${interaction.id}.webp`;
        await uploadToS3(gridFilename, gridBuffer);

        const embed = new EmbedBuilder()
            .setTitle('🧭 Variation Neighborhood: Creativity Grid')
            .setDescription(`Top-Left (Subtle 0.5) to Bottom-Right (Dramatic 0.95).\nExplore the spectrum of artistic evolution.`)
            .setColor('#10b981')
            .setImage('attachment://variations.png');

        await interaction.editReply({
            content: '', embeds: [embed],
            files: [new AttachmentBuilder(gridBuffer, { name: 'variations.png' })]
        });

    } catch (e) {
        ctxLogger.error(`Variation Grid failed`, e);
        await interaction.editReply({ content: `❌ **Variation Neighborhood Failed:** ${e.message}` });
    }
}

async function handleLockStyle(interaction, originalInteractionId, imageIndex) {
    await interaction.deferReply({ ephemeral: true });
    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Data not found.' });

    // Store the style (prompt) in the user's profile for mimicry
    const userRef = db.collection('discord_users').doc(interaction.user.id);
    await userRef.set({
        currentStyleMimic: {
            prompt: generationData.prompt,
            imageId: generationData.imageIds[imageIndex],
            lockedAt: new Date().toISOString()
        }
    }, { merge: true });

    await interaction.editReply({ 
        content: `🧪 **Style Locked!** The essence of this image has been captured. Future remixes will attempt to mimic this aesthetic until you lock a new one.` 
    });
}

async function handleGeniusSuggestions(interaction, originalInteractionId, imageIndex, ctx) {
    const { logger: ctxLogger = logger, signal } = ctx;
    await interaction.deferReply({ ephemeral: true });
    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Original generation data not found.' });

    try {
        const API_URL = process.env.DREAMBEES_API_URL;
        const API_KEY = process.env.DREAMBEES_API_KEY;

        const response = await fetchWithTimeout(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
            body: JSON.stringify({
                data: {
                    action: "transformPrompt",
                    prompt: generationData.prompt,
                    styleName: "Genius",
                    intensity: "high",
                    instructions: "suggest 3 distinct and creative one-sentence remix directions for this image. return ONLY a JSON array of strings like ['direction1', 'direction2', 'direction3']"
                }
            }),
            agent: keepAliveAgent,
            signal
        }, 15000);

        const { result } = await response.json();
        let suggestions = ["Cyberpunk Evolution", "Oil Painting Style", "Underwater Dream"]; // Fallback
        
        try {
            // Clean up JSON if Gemini returns markdown
            const cleanResult = result.prompt.replace(/```json|```/g, '').trim();
            suggestions = JSON.parse(cleanResult);
        } catch (e) {
            ctxLogger.warn("Failed to parse Genius suggestions, using fallback", e);
        }

        const embed = new EmbedBuilder()
            .setTitle('🔮 Genius Suggestions')
            .setDescription(`Based on your image, the Alchemist suggests these paths:`)
            .setColor('#a855f7');

        const row = new ActionRowBuilder();
        suggestions.slice(0, 3).forEach((s, i) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`remix_genius_${originalInteractionId}_${imageIndex}_${s.substring(0, 50).replace(/\s+/g, '-')}`)
                    .setLabel(`Idea ${i+1}: ${s.substring(0, 30)}...`)
                    .setStyle(ButtonStyle.Primary)
            );
        });

        await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (e) {
        ctxLogger.error("Genius failed", e);
        await interaction.editReply({ content: "❌ Failed to consult the Genius." });
    }
}

async function handleViewParent(interaction, originalInteractionId, imageIndex, ctx) {
    const { logger: ctxLogger = logger, signal } = ctx;
    await interaction.deferReply({ ephemeral: true });
    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Original generation data not found.' });
    const parentImageId = generationData.parentImageId;

    if (!parentImageId || parentImageId === 'external') {
        return interaction.editReply({ content: "⏳ This image has no traceable parent in our archives." });
    }

    try {
        const API_URL = process.env.DREAMBEES_API_URL;
        const API_KEY = process.env.DREAMBEES_API_KEY;

        const response = await fetchWithTimeout(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
            body: JSON.stringify({
                data: { action: "getImageDetail", imageId: parentImageId }
            }),
            agent: keepAliveAgent,
            signal
        }, 10000);

        const { result } = await response.json();
        const embed = new EmbedBuilder()
            .setTitle('⏳ Creative Parent')
            .setDescription(`This is the ancestor of your current creation.\n\n**Prompt:** ${result.prompt}`)
            .setImage(result.imageUrl)
            .setColor('#64748b');

        await interaction.editReply({ embeds: [embed] });
    } catch (e) {
        ctxLogger.error("View Parent failed", e);
        await interaction.editReply({ content: "❌ Could not retrieve parent data." });
    }
}

async function handleShowRemixModal(interaction, originalInteractionId, imageIndex, strength = 0.75, focus = 'all', ctx = {}) {
    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) {
        return interaction.reply({ content: '❌ Original generation data not found.', ephemeral: true });
    }

    const modal = new ModalBuilder()
        .setCustomId(`remix_upscale_${originalInteractionId}_${imageIndex}_str_${strength}_focus_${focus}`)
        .setTitle(`Remix (${focus === 'all' ? (strength < 0.6 ? 'Subtle' : 'Dramatic') : `Focus: ${focus}`}) 💡`);

    const instructionInput = new TextInputBuilder()
        .setCustomId('instructions')
        .setLabel(focus === 'subject' ? 'Change the Subject...' : (focus === 'environment' ? 'Change the Environment...' : 'Instructions'))
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(focus === 'all' ? 'Describe your changes...' : `Only describe what you want to change in the ${focus}.`)
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(instructionInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

// Shared helper for single vibe remix
async function handleRemixProcess(interaction, originalInteractionId, imageIndex, instructions, options = {}) {
    const { logger: ctxLogger = logger, signal } = options;
    if (interaction.isButton()) await interaction.deferReply({ ephemeral: true });
    else if (interaction.isModalSubmit()) await interaction.deferReply({ ephemeral: true });

    const parts = interaction.customId?.split('_') || [];
    const focus = parts.includes('focus') ? parts[parts.indexOf('focus') + 1] : (options.focus || 'all');

    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Original generation data not found.' });

    const userProfile = await getUserByDiscordId(interaction.user.id);
    if (!userProfile) return interaction.editReply({ content: '❌ Account linking required.' });

    // Style Mimic is stored on the user profile doc (set by handleLockStyle)
    const styleMimic = userProfile.currentStyleMimic || undefined;

    // 1. Safety Guard
    const isSafe = await Hive.guardHive(instructions, { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag, 
        guildId: interaction.guildId 
    });

    if (!isSafe) {
        ctxLogger.warn(`Unsafe remix instruction rejected`, { instructions });
        return interaction.editReply({ content: Hive.Voice.safety });
    }

    await interaction.editReply({ content: '🧪 **Extracting Essence...** Dissolving the original image into astral data.' });

    try {
        const result = await generateRemix(generationData, imageIndex, instructions, userProfile.uid, interaction, {
            strength: options.strength || 0.75,
            focus,
            styleMimic,
            logger: ctxLogger,
            signal
        });
        
        await interaction.editReply({ content: '🪄 **Weaving the Soul...** Merging your instructions with the new vision.' });

        // Generate Lore and Insight in parallel
        const [comparisonBuffer, insight, lore] = await Promise.all([
            stitchSideBySide(result.originalBuffer, result.buffer),
            getAlchemistInsight(result.prompt, instructions, ctxLogger, signal),
            getLoreFragment(result.prompt, ctxLogger, signal)
        ]);

        await interaction.editReply({ content: '✨ **Finalizing Transmutation...**' });
        
        const embed = new EmbedBuilder()
            .setTitle('🧬 Evolution Hero: Transmutation Complete')
            .setDescription(`**Instructions:** ${instructions}\n**Parent ID:** \`${result.parentImageId}\`\n\n**Echo of the Void 📖**\n*"${lore}"*\n\n**Alchemist's Insight 🧠**\n*"${insight}"*`)
            .setColor('#facc15')
            .setImage('attachment://evolution.png')
            .setFooter({ text: 'DreamBees Supreme Alchemist • Transcendental Creative Engine' });

        const row = new ActionRowBuilder().addComponents(
             new ButtonBuilder()
                .setCustomId(`remix_upscale_${result.requestId}_0`)
                .setLabel('Remix Again 💡')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('View Full Remix')
                .setStyle(ButtonStyle.Link)
                .setURL(result.imageUrl)
        );

        await interaction.editReply({
            content: '', embeds: [embed],
            files: [new AttachmentBuilder(comparisonBuffer, { name: 'evolution.png' })],
            components: [row]
        });

    } catch (e) {
        ctxLogger.error(`Remix failed`, e);
        await interaction.editReply({ content: `❌ **Remix Failed:** ${e.message}` });
    }
}

async function getAlchemistInsight(prompt, instructions, ctxLogger = logger, signal = null) {
    try {
        const API_URL = process.env.DREAMBEES_API_URL;
        const API_KEY = process.env.DREAMBEES_API_KEY;

        const response = await fetchWithTimeout(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
            body: JSON.stringify({
                data: {
                    action: "transformPrompt",
                    prompt: prompt,
                    styleName: "Insight",
                    intensity: "low",
                    instructions: `Act as a mystical creative mentor. Provide a one-sentence artistic critique or suggestion for the next evolutionary step based on these instructions: "${instructions}". Keep it short and evocative.`
                }
            }),
            agent: keepAliveAgent,
            signal
        }, 10000);

        const { result } = await response.json();
        return result?.prompt?.substring(0, 200) || "The essence defies simple description.";
    } catch (e) {
        return "The astral paths are clouded, but the vision remains potent.";
    }
}

async function getLoreFragment(prompt, ctxLogger = logger, signal = null) {
    try {
        const API_URL = process.env.DREAMBEES_API_URL;
        const API_KEY = process.env.DREAMBEES_API_KEY;

        const response = await fetchWithTimeout(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
            body: JSON.stringify({
                data: {
                    action: "transformPrompt",
                    prompt: prompt,
                    styleName: "Lore",
                    intensity: "low",
                    instructions: "Act as a chronicler of the void. Provide a one-sentence, epic fragment of lore for this image. Be concise, mysterious, and building a mythology. Start the lore immediately without prefix."
                }
            }),
            agent: keepAliveAgent,
            signal
        }, 10000);

        const { result } = await response.json();
        return (result?.prompt || '').substring(0, 200).replace(/^Fragment of Lore:|^Lore Fragment:|^Lore: /i, '').trim() || "Not even the stars remember the origin of this Vision.";
    } catch (e) {
        return "Not even the stars remember the origin of this Vision.";
    }
}

async function handleEliteVibeGrid(interaction, originalInteractionId, imageIndex, ctx = {}) {
    const { logger: ctxLogger = logger } = ctx;
    await interaction.deferReply({ ephemeral: true });

    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Original generation data not found.' });

    const userProfile = await getUserByDiscordId(interaction.user.id);
    if (!userProfile) return interaction.editReply({ content: '❌ Account linking required.' });

    await interaction.editReply({ content: '🎰 **Alchemical Convergence...** Casting 4 distinct vibes simultaneously.' });

    try {
        const vibes = Object.keys(VIBE_INSTRUCTIONS);
        const results = await Promise.all(vibes.map(v => generateRemix(generationData, imageIndex, VIBE_INSTRUCTIONS[v], userProfile.uid, interaction, { logger: ctxLogger, ...ctx })));

        await interaction.editReply({ content: '🪄 **Stitching Astral Planes...**' });

        const buffers = results.map(r => r.buffer);
        const gridBuffer = await stitchImages(buffers, { logger: ctxLogger });
        
        const gridFilename = `remix-grids/${interaction.id}.webp`;
        const gridUrl = `https://${process.env.B2_BUCKET}.${process.env.B2_ENDPOINT}/${gridFilename}`;
        await uploadToS3(gridFilename, gridBuffer);

        const embed = new EmbedBuilder()
            .setTitle('🎰 Elite Vibe Grid')
            .setDescription(`Generated with **Cyberpunk**, **Studio**, **Anime**, and **Dark** styles.\n\n✨ Ancestral Root: \`${results[0].rootImageId || results[0].parentImageId}\``)
            .setColor('#facc15')
            .setImage('attachment://grid.png');

        const linksRow = new ActionRowBuilder();
        results.forEach((r, i) => {
             linksRow.addComponents(new ButtonBuilder().setLabel(`Vibe ${i+1}`).setStyle(ButtonStyle.Link).setURL(`https://dreambeesai.com/image/${r.imageId}`));
        });

        await interaction.editReply({
            content: '', embeds: [embed],
            files: [new AttachmentBuilder(gridBuffer, { name: 'grid.png' })],
            components: [linksRow]
        });

    } catch (e) {
        ctxLogger.error(`Vibe Grid failed`, e);
        await interaction.editReply({ content: `❌ **Vibe Grid Failed:** ${e.message}` });
    }
}

// Core remix generation logic with lineage tracking
async function generateRemix(generationData, imageIndex, instructions, uid, interaction, options = {}) {
    const { strength = 0.75, focus = 'all', styleMimic = null, logger: ctxLogger = logger, signal } = typeof options === 'object' ? options : { strength: options };
    
    const API_URL = process.env.DREAMBEES_API_URL;
    const API_KEY = process.env.DREAMBEES_API_KEY;
    const originalImageUrl = generationData.urls[imageIndex];
    const parentImageId = generationData.imageIds[imageIndex];
    const rootImageId = generationData.rootImageId || parentImageId;
    const targetUserId = uid?.includes(':') ? uid : `discord:${uid}`;

    // Fetch original image buffer early for comparison
    const originalRes = await fetchWithTimeout(originalImageUrl, { agent: keepAliveAgent, signal }, 15000);
    const originalBuffer = Buffer.from(await originalRes.arrayBuffer());

    // 1. AI Merge with Surgical Instructions
    let focusInstruction = "";
    if (focus === 'subject') {
        focusInstruction = "SURGICAL FOCUS: Modify ONLY the subject. Keep the environment, background, and lighting exactly as described in the original prompt.";
    } else if (focus === 'environment') {
        focusInstruction = "SURGICAL FOCUS: Modify ONLY the environment/background. Keep the subject, their pose, and their core features exactly as described in the original prompt.";
    }

    let styleInstruction = "";
    if (styleMimic) {
        styleInstruction = `STYLE MIMICRY: Apply the aesthetic essence (color palette, mood, lighting) of this style: "${styleMimic.prompt}".`;
    }

    const transformResponse = await fetchWithTimeout(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
        body: JSON.stringify({
            data: {
                action: "transformPrompt",
                prompt: generationData.prompt,
                styleName: "Masterpiece",
                intensity: "high",
                instructions: wrapInAegis(`${focusInstruction} ${styleInstruction} Instructions: ${instructions}`.trim())
            }
        }),
        agent: keepAliveAgent,
        signal
    }, 15000);

    const { result: transformResult } = await transformResponse.json();
    const mergedPrompt = transformResult?.prompt || `${generationData.prompt}. ${instructions}`;

    // 2. Submit Generation
    const submitResponse = await fetchWithTimeout(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
        body: JSON.stringify({
            data: {
                action: "createGenerationRequest",
                prompt: mergedPrompt,
                modelId: "flux-klein-4b",
                image: originalImageUrl,
                strength: strength,
                targetUserId: targetUserId,
                targetDisplayName: interaction.user.tag,
                targetPhotoURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                aspectRatio: generationData.aspectRatio || "1:1",
                shouldBookmark: true,
                metadata: {
                    parentImageId,
                    rootImageId,
                    focus,
                    styleMimicId: styleMimic?.imageId,
                    source: 'discord_remix'
                }
            }
        }),
        agent: keepAliveAgent,
        signal
    }, 30000);

    const { result: submitResult } = await submitResponse.json();
    const requestId = submitResult?.requestId;
    if (!requestId) throw new Error("Backend did not return a requestId.");

    // 3. Poll Firestore with lifecycle-aware safety
    const queueRef = db.collection('generation_queue').doc(requestId);
    const generationResult = await new Promise((resolve, reject) => {
        let isSettled = false;
        let unsubscribe;

        const settle = (callback, value) => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(hardTimeout);
            if (unsubscribe) unsubscribe();
            callback(value);
        };

        const onAbort = () => settle(reject, new Error("Generation cancelled by user or system shutdown."));
        if (signal) {
            if (signal.aborted) return onAbort();
            signal.addEventListener('abort', onAbort, { once: true });
        }

        unsubscribe = queueRef.onSnapshot(async (snapshot) => {
            const data = snapshot.data();
            if (!data) return;
            if (data.status === 'completed' && data.imageUrl) {
                settle(resolve, { imageUrl: data.imageUrl, imageId: data.resultImageId });
            } else if (data.status === 'failed') {
                settle(reject, new Error(data.error || "Generation failed in backend"));
            }
        }, (err) => {
            settle(reject, err);
        });

        // Hard Timeout (2 minutes)
        const hardTimeout = setTimeout(() => settle(reject, new Error("Generation timed out after 2 minutes of silence.")), 120000);
    });

    // 4. Fetch final image
    const imgRes = await fetchWithTimeout(generationResult.imageUrl, { agent: keepAliveAgent, signal }, 30000);
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // 5. Save locally with lineage
    await saveGeneration(requestId, {
        prompt: mergedPrompt, modelId: "flux-klein-4b", userId: interaction.user.id,
        dreambeesUid: targetUserId, guildId: interaction.guildId,
        urls: [generationResult.imageUrl], imageIds: [generationResult.imageId],
        gridUrl: generationResult.imageUrl, cost: 0.5,
        parentImageId, rootImageId
    });

    return { 
        buffer, 
        originalBuffer,
        imageUrl: generationResult.imageUrl,
        imageId: generationResult.imageId, 
        requestId, 
        parentImageId, 
        rootImageId 
    };
}
