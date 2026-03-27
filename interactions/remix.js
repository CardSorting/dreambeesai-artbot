import { db, getGeneration, getUserByDiscordId, saveGeneration } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { fetchWithTimeout, keepAliveAgent } from '../lib/api/dreambees.js';
import { stitchImages, validateImageBuffer, stitchSideBySide, stitchNarrativeStrip } from '../lib/image-processor.js';
import { uploadToS3 } from '../lib/s3.js';
import { Wallet } from '../lib/wallet.js';
import * as Hive from '../lib/hive.js';
import { CONFIG } from '../lib/config-check.js';

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

const REMIX_COST = CONFIG.COSTS.REMIX;
const PRISM_COST = CONFIG.COSTS.PRISM;
const VARIATION_COST = CONFIG.COSTS.VARIATION;
const MATCH_COST = CONFIG.COSTS.MATCH;

export async function execute(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1]; // 'upscale', 'vibe', 'vibegrid', or 'tools'
    const originalInteractionId = parts[2];
    const imageIndex = parseInt(parts[3], 10);
    const vibeId = parts[4]; 

    if (action === 'upscale' && interaction.isButton()) {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex);
    } else if (action === 'upscale' && interaction.isModalSubmit()) {
        const instructions = interaction.fields.getTextInputValue('instructions');
        const strength = interaction.customId.includes('_str_') ? parseFloat(interaction.customId.split('_str_')[1]) : 0.75;
        await handleRemixProcess(interaction, originalInteractionId, imageIndex, instructions, { strength });
    } else if (action === 'vibe') {
        const instructions = VIBE_INSTRUCTIONS[vibeId];
        await handleRemixProcess(interaction, originalInteractionId, imageIndex, instructions);
    } else if (action === 'vibegrid') {
        await handleEliteVibeGrid(interaction, originalInteractionId, imageIndex);
    } else if (action === 'tools' && interaction.isStringSelectMenu()) {
        await handleRemixTools(interaction, originalInteractionId, imageIndex);
    } else if (action === 'genius' && interaction.isButton()) {
        const instruction = parts[4]; // The specific suggestion
        await handleRemixProcess(interaction, originalInteractionId, imageIndex, instruction);
    } else if (action === 'match' && interaction.isModalSubmit()) {
        const instructions = interaction.fields.getTextInputValue('instructions');
        await handleGenerateMatchProcess(interaction, originalInteractionId, imageIndex, instructions);
    }
}

async function handleRemixTools(interaction, originalInteractionId, imageIndex) {
    const choice = interaction.values[0];
    
    if (choice === 'genius') {
        await handleGeniusSuggestions(interaction, originalInteractionId, imageIndex);
    } else if (choice === 'strength_low') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.5);
    } else if (choice === 'strength_high') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.9);
    } else if (choice === 'history') {
        await handleViewParent(interaction, originalInteractionId, imageIndex);
    } else if (choice === 'focus_subject') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.75, 'subject');
    } else if (choice === 'focus_environment') {
        await handleShowRemixModal(interaction, originalInteractionId, imageIndex, 0.75, 'environment');
    } else if (choice === 'lock_style') {
        await handleLockStyle(interaction, originalInteractionId, imageIndex);
    } else if (choice === 'explore_variations') {
        await handleExploreVariations(interaction, originalInteractionId, imageIndex);
    } else if (choice === 'generate_match') {
        await handleShowMatchModal(interaction, originalInteractionId, imageIndex);
    } else if (choice === 'view_mural') {
        await handleViewMural(interaction, originalInteractionId, imageIndex);
    } else if (choice === 'summon_prism') {
        await handleSummonPrism(interaction, originalInteractionId, imageIndex);
    }
}

async function handleSummonPrism(interaction, originalInteractionId, imageIndex) {
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
        const results = await Promise.all(dimensions.map(d => generateRemix(generationData, imageIndex, PRISM_INSTRUCTIONS[d], userProfile.uid, interaction)));

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
        logger.error(`Prism failed`, e);
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

async function handleGenerateMatchProcess(interaction, originalInteractionId, imageIndex, instructions) {
    await interaction.deferReply({ ephemeral: true });
    
    // Fix collection name and use centralized profile
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
            strength: 1.0, // High strength because we want a total match of style on a new subject
            styleMimic
        });

        const embed = new EmbedBuilder()
            .setTitle('🌈 Visual DNA Match: Manifestation Complete')
            .setDescription(`**Subject:** ${instructions}\n**Style Seed:** \`${styleMimic?.imageId || 'Current'}\`\n\n✨ This creation shares the identical aesthetic essence of your original work.`)
            .setColor('#a855f7')
            .setImage(result.imageUrl);

        await interaction.editReply({ content: '', embeds: [embed] });
    } catch (e) {
        await interaction.editReply({ content: `❌ **Match Failed:** ${e.message}` });
    }
}

async function handleViewMural(interaction, originalInteractionId, imageIndex) {
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
                agent: keepAliveAgent
            }, 10000);
            const { result } = await res.json();
            const imgRes = await fetchWithTimeout(result.imageUrl, { agent: keepAliveAgent }, 15000);
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
        logger.error("Mural failed", e);
        await interaction.editReply({ content: "❌ Failed to weave the Lineage Mural." });
    }
}

async function handleExploreVariations(interaction, originalInteractionId, imageIndex) {
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
        const results = await Promise.all(strengths.map(s => generateRemix(generationData, imageIndex, "Refine and enhance this concept with varying degrees of creativity", userProfile.uid, interaction, { strength: s })));

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
        logger.error(`Variation Grid failed`, e);
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

async function handleGeniusSuggestions(interaction, originalInteractionId, imageIndex) {
    await interaction.deferReply({ ephemeral: true });
    const generationData = await getGeneration(originalInteractionId);
    
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
            agent: keepAliveAgent
        }, 15000);

        const { result } = await response.json();
        let suggestions = ["Cyberpunk Evolution", "Oil Painting Style", "Underwater Dream"]; // Fallback
        
        try {
            // Clean up JSON if Gemini returns markdown
            const cleanResult = result.prompt.replace(/```json|```/g, '').trim();
            suggestions = JSON.parse(cleanResult);
        } catch (e) {
            logger.warn("Failed to parse Genius suggestions, using fallback", e);
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
        logger.error("Genius failed", e);
        await interaction.editReply({ content: "❌ Failed to consult the Genius." });
    }
}

async function handleViewParent(interaction, originalInteractionId, imageIndex) {
    await interaction.deferReply({ ephemeral: true });
    const generationData = await getGeneration(originalInteractionId);
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
            agent: keepAliveAgent
        }, 10000);

        const { result } = await response.json();
        const embed = new EmbedBuilder()
            .setTitle('⏳ Creative Parent')
            .setDescription(`This is the ancestor of your current creation.\n\n**Prompt:** ${result.prompt}`)
            .setImage(result.imageUrl)
            .setColor('#64748b');

        await interaction.editReply({ embeds: [embed] });
    } catch (e) {
        await interaction.editReply({ content: "❌ Could not retrieve parent data." });
    }
}

async function handleShowRemixModal(interaction, originalInteractionId, imageIndex, strength = 0.75, focus = 'all') {
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
    if (interaction.isButton()) await interaction.deferReply({ ephemeral: true });
    else if (interaction.isModalSubmit()) await interaction.deferReply({ ephemeral: true });

    const parts = interaction.customId?.split('_') || [];
    const focus = parts.includes('focus') ? parts[parts.indexOf('focus') + 1] : (options.focus || 'all');

    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Original generation data not found.' });

    const userProfile = await getUserByDiscordId(interaction.user.id);
    if (!userProfile) return interaction.editReply({ content: '❌ Account linking required.' });

    // Fetch Style Mimic from user profile
    const userDoc = await db.collection('users').doc(interaction.user.id).get();
    const styleMimic = userDoc.data()?.currentStyleMimic;

    await interaction.editReply({ content: '🧪 **Extracting Essence...** Dissolving the original image into astral data.' });

    try {
        const result = await generateRemix(generationData, imageIndex, instructions, userProfile.uid, interaction, {
            strength: options.strength || 0.75,
            focus,
            styleMimic
        });
        
        await interaction.editReply({ content: '🪄 **Weaving the Soul...** Merging your instructions with the new vision.' });

        // Generate Lore and Insight in parallel
        const [comparisonBuffer, insight, lore] = await Promise.all([
            stitchSideBySide(result.originalBuffer, result.buffer),
            getAlchemistInsight(result.prompt, instructions),
            getLoreFragment(result.prompt)
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
        logger.error(`Remix failed`, e);
        await interaction.editReply({ content: `❌ **Remix Failed:** ${e.message}` });
    }
}

async function getAlchemistInsight(prompt, instructions) {
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
            agent: keepAliveAgent
        }, 10000);

        const { result } = await response.json();
        return result.prompt.substring(0, 200);
    } catch (e) {
        return "The astral paths are clouded, but the vision remains potent.";
    }
}

async function getLoreFragment(prompt) {
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
            agent: keepAliveAgent
        }, 10000);

        const { result } = await response.json();
        return result.prompt.substring(0, 200).replace(/^Fragment of Lore:|^Lore Fragment:|^Lore: /i, '').trim();
    } catch (e) {
        return "Not even the stars remember the origin of this Vision.";
    }
}

async function handleEliteVibeGrid(interaction, originalInteractionId, imageIndex) {
    await interaction.deferReply({ ephemeral: true });

    const generationData = await getGeneration(originalInteractionId);
    if (!generationData) return interaction.editReply({ content: '❌ Original generation data not found.' });

    const userProfile = await getUserByDiscordId(interaction.user.id);
    if (!userProfile) return interaction.editReply({ content: '❌ Account linking required.' });

    await interaction.editReply({ content: '🎰 **Alchemical Convergence...** Casting 4 distinct vibes simultaneously.' });

    try {
        const vibes = Object.keys(VIBE_INSTRUCTIONS);
        const results = await Promise.all(vibes.map(v => generateRemix(generationData, imageIndex, VIBE_INSTRUCTIONS[v], userProfile.uid, interaction)));

        await interaction.editReply({ content: '🪄 **Stitching Astral Planes...**' });

        const buffers = results.map(r => r.buffer);
        const gridBuffer = await stitchImages(buffers);
        
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
        logger.error(`Vibe Grid failed`, e);
        await interaction.editReply({ content: `❌ **Vibe Grid Failed:** ${e.message}` });
    }
}

// Core remix generation logic with lineage tracking
async function generateRemix(generationData, imageIndex, instructions, uid, interaction, options = {}) {
    const { strength = 0.75, focus = 'all', styleMimic = null } = typeof options === 'object' ? options : { strength: options };
    
    const API_URL = process.env.DREAMBEES_API_URL;
    const API_KEY = process.env.DREAMBEES_API_KEY;
    const originalImageUrl = generationData.urls[imageIndex];
    const parentImageId = generationData.imageIds[imageIndex];
    const rootImageId = generationData.rootImageId || parentImageId;

    // Fetch original image buffer early for comparison
    const originalRes = await fetchWithTimeout(originalImageUrl, { agent: keepAliveAgent }, 15000);
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
                instructions: `${focusInstruction} ${styleInstruction} Instructions: ${instructions}`.trim()
            }
        }),
        agent: keepAliveAgent
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
                targetUserId: uid,
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
        agent: keepAliveAgent
    }, 30000);

    const { result: submitResult } = await submitResponse.json();
    const requestId = submitResult?.requestId;
    if (!requestId) throw new Error("Backend did not return a requestId.");

    // 3. Poll Firestore
    const queueRef = db.collection('generation_queue').doc(requestId);
    const generationResult = await new Promise((resolve, reject) => {
        const unsubscribe = queueRef.onSnapshot(async (snapshot) => {
            const data = snapshot.data();
            if (!data) return;
            if (data.status === 'completed' && data.imageUrl) {
                unsubscribe();
                resolve({ imageUrl: data.imageUrl, imageId: data.resultImageId });
            } else if (data.status === 'failed') {
                unsubscribe();
                reject(new Error(`Remix failed`));
            }
        });
        setTimeout(() => { unsubscribe(); reject(new Error("Timeout")); }, 120000);
    });

    // 4. Fetch final image
    const imgRes = await fetchWithTimeout(generationResult.imageUrl, { agent: keepAliveAgent }, 30000);
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // 5. Save locally with lineage
    await saveGeneration(requestId, {
        prompt: mergedPrompt, modelId: "flux-klein-4b", userId: interaction.user.id,
        dreambeesUid: uid, guildId: interaction.guildId,
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
