import { saveGeneration, tryLock, releaseLock, getRemainingCooldown, setCooldown, getUserByDiscordId, getOrCreateDiscordUser } from './db.js';
import { uploadToS3 } from './s3.js';
import { logger } from './logger.js';
import { Wallet } from './wallet.js';
import { MODELS, calculateBatchCost } from './models.js';
import pLimit from 'p-limit';

import { recordGenerationMetrics } from './metrics.js';
import { generateSingleImage, registerDiscordGrid, isCircuitOpen } from './api/dreambees.js';
import { stitchImages, validateImageBuffer } from './image-processor.js';
import { AttachmentBuilder } from 'discord.js';
import { 
    createGenerationEmbed, 
    createUpscaleRow, 
    createNavRow, 
    createModRow 
} from './discord-ux.js';
import { wrapInAegis } from './safety-utils.js';
import { refineNectar } from './hive.js';

const MAX_GLOBAL_CONCURRENT = 50;
let currentGlobalJobs = 0;

/**
 * Standard S3 Upload with Retry Logic
 */
async function uploadToS3WithRetry(filename, buffer, retries = 3) {
    try {
        return await uploadToS3(filename, buffer);
    } catch (err) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 1000 * (4 - retries)));
            return uploadToS3WithRetry(filename, buffer, retries - 1);
        }
        throw err;
    }
}

/**
 * The main orchestrator for image generation.
 */
export async function performGeneration(interaction, discordUserId, prompt, modelId) {
    const discordId = interaction.user.id;
    const interactionId = interaction.id;
    const startTime = Date.now();
    const batchSize = 4;
    const totalCost = calculateBatchCost(modelId, batchSize);
    let zapsDebited = 0;

    // 1. Rate Limiting (Cooldown)
    const cooldownMs = await getRemainingCooldown(discordId);
    if (cooldownMs > 0) {
        const seconds = Math.ceil(cooldownMs / 1000);
        return interaction.editReply({ 
            content: `🐝 **Bzzzzt!** Don't overwork the swarm! Please wait **${seconds}s** before starting another generation.`, 
            ephemeral: true 
        });
    }

    // 2. Health & Capacity Checks
    if (isCircuitOpen()) {
        return interaction.editReply({ content: '🍯 **Restoring Nectar...** Honey-making vats are being refilled. Please wait a moment!', components: [] });
    }

    const lockAcquired = await tryLock(discordId);
    if (!lockAcquired) {
        return interaction.editReply({ content: '⏳ **Active Worker!** You already have a busy bee working on a generation for you!', ephemeral: true });
    }

    if (currentGlobalJobs >= MAX_GLOBAL_CONCURRENT) {
        await releaseLock(discordId);
        return interaction.editReply({ content: '🔥 **Hive Swarmed!** Extreme system load. Please try again soon.', components: [] });
    }

    currentGlobalJobs++;

    try {
        // 3. Final Wallet Check & Debit
        const userProfile = await getUserByDiscordId(discordId);
        if (!userProfile || (userProfile.zaps || 0) < totalCost) {
            throw new Error(`Insufficient Zaps. Need ${totalCost}, have ${(userProfile?.zaps || 0).toFixed(1)}`);
        }

        logger.info(`Debiting wallet for generation`, { discordId, discordUserId, totalCost });
        const debitResult = await Wallet.debit(userProfile.uid, totalCost, interactionId, { prompt, modelId });
        if (!debitResult.success) throw new Error('Wallet transaction failed.');
        zapsDebited = totalCost;

        const targetUserId = `discord:${discordId}`;
        const targetDisplayName = interaction.user.tag;
        const targetPhotoURL = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });
        logger.info(`Starting generation workflow`, { discordId, targetUserId, modelId });

        // 3. Concurrent Image Generation
        const limit = pLimit(2); 
        
        // Perimeter Check: Final Refinement & Aegis Wrap
        const refined = refineNectar(prompt);
        const safePrompt = wrapInAegis(refined);
        
        logger.info(`Dispatching Hive Sentry approved prompt`, { interactionId, refinedLength: refined.length });

        const results = await Promise.all([
            limit(() => generateSingleImage(safePrompt, modelId, targetUserId, targetDisplayName, targetPhotoURL)),
            limit(() => generateSingleImage(safePrompt, modelId, targetUserId, targetDisplayName, targetPhotoURL)),
            limit(() => generateSingleImage(safePrompt, modelId, targetUserId, targetDisplayName, targetPhotoURL)),
            limit(() => generateSingleImage(safePrompt, modelId, targetUserId, targetDisplayName, targetPhotoURL))
        ]);

        const buffers = results.map(r => r.buffer);
        const s3Urls = results.map(r => r.url);
        const imageIds = results.map(r => r.imageId);

        // 4. Validation & Stitching
        await Promise.all(buffers.map((buf, i) => validateImageBuffer(buf, `Image ${i+1}`)));
        const gridBuffer = await stitchImages(buffers);

        // 5. Grid Storage & Registration (Sync to Web App)
        const gridFilename = `discord-grids/${interactionId}.webp`;
        const gridUrl = await uploadToS3WithRetry(gridFilename, gridBuffer);
        
        // Push to Web App indexed by standardized Shadow ID
        await registerDiscordGrid(gridUrl, prompt, modelId, targetUserId, targetDisplayName, targetPhotoURL, interactionId)
            .catch(err => logger.error("Grid Sync Failed", err));

        // 6. Build Discord Response
        const embeds = [createGenerationEmbed(prompt, modelId)];

        // 7. Save to Local Persistence
        await saveGeneration(interactionId, {
            prompt, modelId, userId: discordId, dreambeesUid: targetUserId,
            guildId: interaction.guildId, urls: s3Urls, imageIds, gridUrl, cost: totalCost
        });

        // 8. Send Results
        await interaction.editReply({ 
            embeds: embeds, 
            files: [new AttachmentBuilder(gridBuffer, { name: 'generation.png' })],
            components: [createUpscaleRow(interactionId, imageIds), createModRow(interactionId)]
        });

        // 9. Update Transaction Status
        await Wallet.updateStatus(interactionId, 'completed');

        // 9. Post-Generation Cleanup & Metrics
        await setCooldown(discordId, 30000);
        
        const duration = Date.now() - startTime;
        logger.info(`Generation successful`, { interactionId, duration });

        recordGenerationMetrics({
            interactionId, userId: discordId, prompt, modelId,
            status: 'success', durationMs: duration, imagesCount: 4
        });

    } catch (error) {
        logger.error(`Generation Workflow failed`, { interactionId, error });
        
        // 10. Automatic Refund logic
        if (zapsDebited > 0) {
            try {
                const userProfile = await getUserByDiscordId(discordId);
                if (userProfile) {
                    logger.info(`Issuing refund for failed generation`, { discordId, amount: zapsDebited });
                    await Wallet.credit(userProfile.uid, zapsDebited, `${interactionId}_refund`, { 
                        reason: 'Generation Failure', 
                        originalError: error.message,
                        source: 'discord'
                    });
                    
                    // Mark original debit as refunded
                    await Wallet.updateStatus(interactionId, 'refunded');
                }
            } catch (refundErr) {
                logger.error(`REFUND FAILED! Manual intervention required.`, { interactionId, refundErr });
            }
        }

        await interaction.editReply({ 
            content: `❌ **Generation Failed:** ${error.message}. ${zapsDebited > 0 ? 'Your Zaps have been automatically refunded.' : ''}`, 
            components: [] 
        });
    } finally {
        currentGlobalJobs--;
        await releaseLock(discordId);
    }
}
