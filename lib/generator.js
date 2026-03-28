import { db, logger } from './firebase.js';
import { tryLock, releaseLock } from './db/locks.js';
import { getRemainingCooldown, setCooldown } from './db/cooldowns.js';
import { getUserByDiscordId } from './db/users.js';
import { Wallet } from './wallet.js';
import { calculateBatchCost } from './models.js';
import { isCircuitOpen } from './api/dreambees.js';
import { createCloudTask } from './queue/cloudtasks.js';
import { 
    createGenerationEmbed, 
    createUpscaleRow, 
    createModRow 
} from './discord-ux.js';
import { AttachmentBuilder } from 'discord.js';
import fetch from 'node-fetch';

const MAX_GLOBAL_QUEUE = 500; 
let currentEnqueuedJobs = 0;

/**
 * The main orchestrator for image generation via Cloud Tasks.
 */
export async function performGeneration(interaction, discordUserId, prompt, modelId, options = {}) {
    const { logger: ctxLogger = logger, signal } = options;
    const discordId = interaction.user.id;
    const interactionId = interaction.id;
    
    // 0. Interaction Deferral
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
    }

    try {
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
            ctxLogger.warn(`Generation blocked: Circuit Breaker is OPEN`);
            return interaction.editReply({ content: '🍯 **Restoring Nectar...** Honey-making vats are being refilled. Please wait a moment!', components: [] });
        }

        const lockAcquired = await tryLock(discordId, interactionId);
        if (!lockAcquired) {
            return interaction.editReply({ content: '⏳ **Active Worker!** You already have a busy bee working on a generation for you!', ephemeral: true });
        }

        if (currentEnqueuedJobs >= MAX_GLOBAL_QUEUE) {
            return interaction.editReply({ content: '🔥 **Hive Swarmed!** Extreme system load. Please try again soon.', components: [] });
        }

        // 3. Final Pre-flight (Consolidated Debit & State Creation)
        const totalCost = calculateBatchCost(modelId, 4);
        const targetUserId = `discord:${discordId}`;
        const targetDisplayName = interaction.user.tag;
        const targetPhotoURL = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });
        
        ctxLogger.info(`Initiating consolidated pre-flight`, { totalCost, interactionId });
        
        // CONSOLIDATED ROUND TRIP: Unified debit and queue state creation
        const debitResult = await Wallet.debit(discordId, totalCost, interactionId, { 
            prompt, 
            modelId,
            autoQueue: {
                collection: 'generation_queue',
                data: {
                    status: 'queued',
                    prompt,
                    modelId,
                    userId: targetUserId,
                    discordId: discordId,
                    guildId: interaction.guildId || 'dm',
                    cost: totalCost,
                    targetDisplayName,
                    targetPhotoURL,
                    source: 'discord_bot_cloudtasks'
                }
            }
        });

        if (!debitResult.success) {
            throw new Error(debitResult.error || 'Wallet transaction failed.');
        }

        const queueRef = db.collection('generation_queue').doc(interactionId);
        currentEnqueuedJobs++;

        // 5. Enqueue via Cloud Tasks (PUSH)
        await createCloudTask({
            requestId: interactionId,
            prompt,
            modelId,
            userId: targetUserId,
            discordId,
            guildId: interaction.guildId || 'dm',
            cost: totalCost,
            targetDisplayName,
            targetPhotoURL,
            batchSize: 4
        });

        // 6. Observe Progress (Observer Pattern stays same, just reacting to webhook updates)
        return await new Promise((resolve, reject) => {
            let isSettled = false;
            let unsubscribe;

            const settle = (callback, value) => {
                if (isSettled) return;
                isSettled = true;
                if (unsubscribe) unsubscribe();
                clearTimeout(hardTimeout);
                callback(value);
            };

            // Initial status update
            interaction.editReply({ content: '🐝 **Queued!** Offloaded to Cloud Tasks Hive. Preparing worker...' }).catch(() => {});

            unsubscribe = queueRef.onSnapshot(async (snapshot) => {
                const data = snapshot.data();
                if (!data) return;

                if (data.status === 'processing') {
                    await interaction.editReply({ content: '🎨 **Processing...** Cloud Tasks has delivered your request to an active worker!' }).catch(() => {});
                } else if (data.status === 'completed') {
                    try {
                        const res = await fetch(data.gridUrl);
                        const gridBuffer = Buffer.from(await res.arrayBuffer());

                        const embeds = [createGenerationEmbed(prompt, modelId)];
                        
                        if (signal?.aborted) return;
                        await interaction.editReply({ 
                            content: '',
                            embeds: embeds, 
                            files: [new AttachmentBuilder(gridBuffer, { name: 'generation.png' })],
                            components: [createUpscaleRow(interactionId, data.imageIds), createModRow(interactionId)]
                        });

                        await setCooldown(discordId, 30000);
                        settle(resolve, true);
                    } catch (err) {
                        ctxLogger.error("Failed to deliver completed generation result", err);
                        settle(reject, err);
                    }
        } else if (data.status === 'failed') {
            // HARDENING: Detailed error reporting for the UI
            const errorMessage = data.error || "Generation failed in the processing hive.";
            ctxLogger.error(`Task ${interactionId} reported failure: ${errorMessage}`);
            settle(reject, new Error(errorMessage));
        }
            }, (err) => {
                ctxLogger.error("Queue observer failed", err);
                settle(reject, err);
            });

            if (signal?.aborted) {
                settle(reject, new Error("Generation cancelled by system shutdown."));
            }

            // Hard Timeout Protection (5 minutes for Cloud Tasks retries)
            const hardTimeout = setTimeout(() => {
                settle(reject, new Error("Generation timed out in Cloud Tasks. The Alchemist has been alerted."));
            }, 300000);

            // Listen for abort signal
            if (signal) {
                signal.addEventListener('abort', () => settle(reject, new Error("Generation aborted by system.")));
            }
        });

    } catch (error) {
        ctxLogger.error('Generation orchestrator failure', error);
        
        const userProfile = await getUserByDiscordId(discordId);
        if (userProfile && (interaction.replied || interaction.deferred)) {
            await Wallet.refund(interactionId, `Orchestration Failure: ${error.message}`).catch(() => {});
        }

        throw error;
    } finally {
        currentEnqueuedJobs--;
        await releaseLock(discordId).catch(e => logger.error('Failed to release generation lock', e));
    }
}

