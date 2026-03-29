import { Client, GatewayIntentBits, Collection, Events, ActivityType, Interaction, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ModalSubmitInteraction } from 'discord.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pLimit from 'p-limit';
import { OAuth2Client } from 'google-auth-library';
import { CloudTasksClient } from '@google-cloud/tasks';
import { HiveGenerator, GenerationTask } from '../services/HiveGenerator.js';

/**
 * PILLAR UTILITY: Structured Logger
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
const levels: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');
const reset = '\x1b[0m';
const SECRET_KEYS = ['api-key', 'token', 'secret', 'password', 'auth', 'key'];

function scrubData(data: any, depth = 0, maxDepth = 3, visited = new WeakSet()): any {
    if (depth >= maxDepth) return '[DEPTH]';
    if (!data || typeof data !== 'object') return data;
    if (visited.has(data)) return '[CIRCULAR]';
    visited.add(data);
    const scrubbed: any = Array.isArray(data) ? [] : {};
    for (const key in data) {
        const val = data[key];
        if (SECRET_KEYS.some(sk => key.toLowerCase().includes(sk))) scrubbed[key] = '[SCRUBBED]';
        else scrubbed[key] = (typeof val === 'object' ? scrubData(val, depth + 1, maxDepth, visited) : val);
    }
    return scrubbed;
}

export class Logger {
    constructor(private ctx: any = {}) {}
    private log(level: LogLevel, message: string, data: any = {}) {
        if (levels[level] < levels[currentLevel]) return;
        const payload = { timestamp: new Date().toISOString(), level, message, ...this.ctx, ...scrubData(data) };
        if (process.env.NODE_ENV === 'production') process.stdout.write(JSON.stringify(payload) + '\n');
        else process.stdout.write(`${level === 'ERROR' ? '\x1b[31m' : '\x1b[36m'}[${level}]${reset} ${message} ${Object.keys(data).length ? JSON.stringify(data) : ''}\n`);
    }
    info(m: string, d?: any) { this.log('INFO', m, d); }
    warn(m: string, d?: any) { this.log('WARN', m, d); }
    error(m: string, d?: any) { this.log('ERROR', m, d); }
    debug(m: string, d?: any) { this.log('DEBUG', m, d); }
    child(c: any) { return new Logger({ ...this.ctx, ...c }); }
}

/**
 * PILLAR MODELS: Internalized Commands
 */
export interface CommandContext {
    logger: Logger;
    jobs: Map<string, any>;
    signal: AbortSignal;
    engine: HiveEngine;
}

export interface Command {
    data: any;
    category?: string;
    execute(interaction: HiveProxyInteraction, context: CommandContext): Promise<any>;
}

import { hivePersistence, COLLECTIONS } from '../services/HivePersistence.js';
import { HiveUX, HiveProxyInteraction, Voice } from './HiveUX.js';
import { HiveSafety } from '../services/HiveSafety.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = new Logger();
const imageLimit = pLimit(Number(process.env.IMAGE_CONCURRENCY) || 4);
const workerLimit = pLimit(Number(process.env.WORKER_CONCURRENCY) || 2);
const cloudTasksClient = new CloudTasksClient();

sharp.cache(false);

export interface Job {
    controller: AbortController;
    createdAt: number;
}

/**
 * MISSION STATE
 * Tracks the lifecycle of a Hive interaction for autonomous recovery.
 */
export enum HiveState {
    AUTHORIZED = 'AUTHORIZED', // Passed safety & residency
    CHARGED = 'CHARGED',       // Zaps debited
    ACTIVE = 'ACTIVE',         // Mission task running
    COMPLETED = 'COMPLETED',   // Mission task finished
    FAILED = 'FAILED'          // Mission task errored
}

/**
 * MISSION PROFILE
 * Defines the behavioral and technical constraints for a Hive task.
 */
export interface MissionProfile {
    category: string;
    description: string;
    cost: number;
    prompt?: string;
    safetyDepth?: 'NONE' | 'STANDARD' | 'STRICT';
    retryLimit?: number;
}

/**
 * MONOLITHIC PILLAR: HiveEngine
 */
export class HiveEngine {
    public config: any;
    private client: Client;
    private server: http.Server | null = null;
    private activeJobs = new Map<string, Job>();
    private commands = new Collection<string, Command>();
    private interactionHandlers = new Collection<string, any>();
    private isInitialized = false;
    private startTime = Date.now();
    private authClient = new OAuth2Client();
    private hiveGenerator = new HiveGenerator();

    // Circuit Breaker State (Monitored Layer)
    private breakers = {
        generation: { count: 0, lastFailure: 0, status: 'CLOSED' as 'CLOSED' | 'OPEN' | 'HALF-OPEN' }
    };

    constructor() {
        dotenv.config();
        this.config = this.loadConfig();
        this.validateConfig();

        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
            makeCache: (manager) => new Collection(),
            sweepers: {
                messages: { interval: 3600, lifetime: 1800 },
                threads: { interval: 3600, lifetime: 3600 },
                reactions: { interval: 3600, filter: () => () => true }
            }
        });
        this.setupProcessHandlers();
    }

    /**
     * SELF-HEALING BOOT
     * Sweeps for pending missions from previous sessions to ensure financial integrity.
     */
    private async healTheHive() {
        logger.info('[HiveEngine] Initiating Self-Healing Boot...');
        const recovered = await hivePersistence.recoverZombies();
        if (recovered > 0) {
            logger.info(`[HiveEngine] Successfully healed ${recovered} orphaned missions.`);
        }
    }

    public async start() {
        logger.info('--- HIVE ENGINE BOOT (SOVEREIGN v4) ---');

        const isHealthy = await hivePersistence.verifyConnectivity();
        if (!isHealthy) {
            logger.warn("HivePersistence check failed. Starting in DEGRADED mode.");
        }


        // Sovereign Boot Sequence
        await hivePersistence.primeWarmCache();
        await this.healTheHive();
        
        await this.loadExtensions();
        await this.initializeDiscord();

        this.initializeServer();
        this.startMaintenance();

        this.isInitialized = true;
        logger.info('----------------------------------------');
        logger.info('   🐝 COLLECTIVE MISSION READY   ');
        logger.info('----------------------------------------');
    }

    private loadConfig() {
        return {
            DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
            DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
            DREAMBEES_API_URL: process.env.DREAMBEES_API_URL || '',
            DREAMBEES_API_KEY: process.env.DREAMBEES_API_KEY || '',
            DREAMBEES_GUILD_ID: process.env.DREAMBEES_GUILD_ID || '',
            GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || '',
            CLOUD_TASKS_LOCATION: process.env.CLOUD_TASKS_LOCATION || '',
            CLOUD_TASKS_QUEUE: process.env.CLOUD_TASKS_QUEUE || '',
            TASK_WEBHOOK_URL: process.env.TASK_WEBHOOK_URL || '',
            NODE_ENV: process.env.NODE_ENV || 'development',
            PORT: process.env.PORT || '8080',
            FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
            CLOUD_TASKS_SA_EMAIL: process.env.CLOUD_TASKS_SA_EMAIL,
            INVITE_LINK: process.env.INVITE_LINK || 'https://discord.com/invite/curMHRAN8y'
        };
    }

    private validateConfig() {
        const required = ['DISCORD_TOKEN', 'DREAMBEES_API_URL', 'GCLOUD_PROJECT', 'TASK_WEBHOOK_URL'];
        const missing = required.filter(k => !(this.config as any)[k]);
        if (missing.length > 0) {
            logger.error(`FATAL: Missing environment variables: ${missing.join(', ')}`);
            process.exit(1);
        }
    }

    // --- Discord Integration ---
    private async initializeDiscord() {
        this.client.once(Events.ClientReady, (c) => {
            logger.info(`Logged in as ${c.user.tag}!`);
        });

        this.client.on(Events.InteractionCreate, async (i: any) => {
            if (!this.isInitialized) return;
            await this.handleInteraction(i);
        });

        await this.client.login(this.config.DISCORD_TOKEN);
    }

    private async handleInteraction(interaction: any) {
        const ctxLogger = logger.child({ interactionId: interaction.id, userId: interaction.user.id });
        const controller = new AbortController();
        this.activeJobs.set(interaction.id, { controller, createdAt: Date.now() });

        try {
            const hiveInteraction = new HiveProxyInteraction(interaction as any);

            if (interaction.isChatInputCommand()) {
                const command = this.commands.get(interaction.commandName);
                if (!command) return;
                await command.execute(hiveInteraction, { logger: ctxLogger, jobs: this.activeJobs, signal: controller.signal, engine: this });
            } else if (interaction.isButton() || interaction.isMessageComponent() || interaction.isModalSubmit()) {
                const customId = (interaction as any).customId;

                if (customId.startsWith('remix_') || customId.startsWith('modal_remix_')) {
                    await this.handleRemixInteraction(hiveInteraction, customId, controller.signal);
                    return;
                }

                if (interaction.isButton()) {
                    await this.handleButton(hiveInteraction, controller.signal);
                } else {
                    const prefix = Array.from(this.interactionHandlers.keys()).find(p => customId.startsWith(p));
                    if (prefix) {
                        const handler = this.interactionHandlers.get(prefix);
                        await handler.execute(hiveInteraction, { logger: ctxLogger, jobs: this.activeJobs, signal: controller.signal });
                    }
                }
            }
        } finally {
            this.activeJobs.delete(interaction.id);
        }
    }

    /**
     * UNIVERSAL ORCHESTRATION PIPELINE (Autonomous State Machine)
     */
    async orchestrate(
        interaction: HiveProxyInteraction, 
        mission: MissionProfile,
        task: (signal: AbortSignal) => Promise<any>
    ) {
        const discordId = interaction.user.id;
        const signal = this.activeJobs.get(interaction.id)?.controller.signal || new AbortController().signal;
        let state = HiveState.AUTHORIZED;

        // 1. Sovereign Risk Analysis (The Shield)
        if (mission.prompt && mission.safetyDepth !== 'NONE') {
            const risk = HiveSafety.analyze(mission.prompt, discordId);
            if (!risk.approved) {
                const strikeWeight = HiveSafety.calculateStrikeWeight(risk);
                await hivePersistence.logModerationEvent({
                    userId: discordId,
                    userTag: interaction.user.tag,
                    guildId: interaction.guildId || 'DM',
                    originalPrompt: mission.prompt,
                    matchedTerm: risk.reason,
                    action: 'PROMPT_REJECTED',
                    strikeWeight
                });
                return await interaction.reply({
                    content: Voice.safety,
                    ephemeral: true
                });
            }
            // Apply Nectar Enrichment if approved
            mission.prompt = HiveSafety.enrich(mission.prompt, mission.category);
        }

        // 2. Instance Loading & Residency Check
        const user = await hivePersistence.getOrCreateUser(discordId, interaction.user.tag);
        const backoff = await HiveSafety.getAbuseBackoff(user);
        if (backoff > 0) {
            return await interaction.reply({
                content: `⚠️ **Hive Guard Active:** Too many safety rejections. Try again in **${Math.ceil(backoff / 60000)}m**.`,
                ephemeral: true
            });
        }

        if (user.zaps < mission.cost) {
            return await interaction.reply({
                content: Voice.emptyJar(mission.cost, user.zaps),
                ephemeral: true
            });
        }

        // 3. Concurrency Lock
        const lockAcquired = await hivePersistence.tryLock(discordId, interaction.id);
        if (!lockAcquired) {
            return await interaction.reply({
                content: `⏳ **Busy Bee!** You already have a worker in the fields.`,
                ephemeral: true
            });
        }

        try {
            // 4. Financial Commit (AUTHORIZED -> CHARGED)
            const debit = await hivePersistence.debit(discordId, mission.cost, interaction.id, {
                prompt: mission.prompt, category: mission.category
            });
            if (!debit.success) throw new Error(debit.error);
            state = HiveState.CHARGED;

            // 5. Sovereignty Execution (CHARGED -> ACTIVE)
            state = HiveState.ACTIVE;
            let attempts = 0;
            const maxAttempts = mission.retryLimit || 1;
            while (attempts < maxAttempts) {
                try {
                    await task(signal);
                    state = HiveState.COMPLETED;
                    break; 
                } catch (taskErr) {
                    attempts++;
                    if (attempts >= maxAttempts) throw taskErr;
                    logger.warn(`Mission attempt ${attempts} failed, retrying...`, { txId: interaction.id });
                    await new Promise(r => setTimeout(r, 1000 * attempts));
                }
            }

        } catch (err: any) {
            logger.error(`Mission Failure [${state}]: ${interaction.id}`, err);
            // Autonomous Refund if charged but not completed
            if (state === HiveState.CHARGED || state === HiveState.ACTIVE) {
                await hivePersistence.refund(interaction.id, err.message || 'Mission Failure');
            }
            await interaction.reply({ content: Voice.failure, ephemeral: true });
        } finally {
            await hivePersistence.releaseLock(discordId);
        }
    }

    private async handleButton(interaction: HiveProxyInteraction, signal: AbortSignal) {
        const customId = (interaction.interaction as any).customId;

        // 1. UPSCALE Handler (Absorbed from ButtonHandler)
        if (customId.startsWith('upscale_')) {
            const parts = customId.split('_');
            const originalInteractionId = parts[1];
            const imageIndex = parseInt(parts[2], 10);

            await interaction.defer({ ephemeral: true });

            try {
                const data = await hivePersistence.getGeneration(originalInteractionId);
                if (!data || !data.urls?.[imageIndex]) {
                    return await interaction.reply({ content: '❌ Image data expired or not found.' });
                }

                const url = data.urls[imageIndex];
                const buffer = await this.fetchBuffer(url, signal);
                if (!buffer) throw new Error('Failed to retrieve nectar (image buffer).');

                const attachment = new AttachmentBuilder(buffer, { name: `harvested_${originalInteractionId.slice(-6)}.webp` });
                const ui = HiveUX.createUpscaleUI(originalInteractionId, imageIndex, url, data.prompt);
                
                await interaction.reply({ ...ui, files: [attachment] });

                await this.syncToWebApp({
                    action: "registerDiscordUpscale",
                    imageUrl: url,
                    prompt: data.prompt,
                    targetUserId: `discord:${interaction.user.id}`,
                    targetDisplayName: interaction.user.tag
                });

            } catch (err: any) {
                logger.error(`Button Logic Failed`, err);
                await interaction.reply({ content: `❌ **Retrieval Failed:** ${err.message}` });
            }
        }

        // 2. DELETE Handler
        if (customId.startsWith('gen_delete_')) {
            try {
                await (interaction.interaction as any).message.delete();
            } catch {
                await interaction.reply({ content: '⚠️ Could not delete message.', ephemeral: true });
            }
        }

        // 3. REMIX Handler (now handled centrally in handleInteraction)
    }

    private async handleRemixInteraction(interaction: HiveProxyInteraction, customId: string, signal: AbortSignal) {
        const parts = customId.split('_');
        
        // Handle native text input modal submissions
        if (customId.startsWith('modal_remix_')) {
            const originalInteractionId = parts[2];
            const imageIndex = parseInt(parts[3], 10);
            const newPrompt = (interaction.interaction as ModalSubmitInteraction).fields.getTextInputValue('prompt');
            await this.dispatchRemixJob(interaction, originalInteractionId, imageIndex, newPrompt, 1, 10);
            return;
        }

        const action = parts[1]; // upscale | vibegrid | vibe | tools
        const originalInteractionId = parts[2];
        const imageIndex = parseInt(parts[3], 10);
        const modifier = parts.length > 4 ? parts[4] : null; 

        // INTERCEPT MANUAL REMIX - SHOW DISCORD MODAL
        if (action === 'upscale') {
            const data = await hivePersistence.getGeneration(originalInteractionId);
            if (!data) return await interaction.reply({ content: '❌ Data expired.', ephemeral: true });

            const modal = new ModalBuilder()
                .setCustomId(`modal_remix_${originalInteractionId}_${imageIndex}`)
                .setTitle('Manual Remix');
                
            const promptInput = new TextInputBuilder()
                .setCustomId('prompt')
                .setLabel('Evolution Directives (Edit Prompt)')
                .setStyle(TextInputStyle.Paragraph)
                .setValue(data.prompt || '')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(promptInput));
            return await (interaction.interaction as any).showModal(modal);
        } 

        // For string select menus (tools), get the value from the interaction
        let toolValue: string | null = modifier;
        if (interaction.interaction.isStringSelectMenu()) {
             toolValue = (interaction.interaction as any).values[0];
        }

        await interaction.defer({ ephemeral: true });

        try {
            const data = await hivePersistence.getGeneration(originalInteractionId);
            if (!data || !data.urls?.[imageIndex]) {
                return await interaction.reply({ content: '❌ Image source expired or not found in the hive.' });
            }

            const imageUrl = data.urls[imageIndex];
            let newPrompt = data.prompt;
            let dispatchCount = action === 'vibegrid' ? 4 : 1;
            let dispatchSteps = 10;

            // Apply standard vibe modifiers
            if (action === 'vibe' && modifier) {
                const styles: Record<string, string> = {
                    cyberpunk: "neon, cyberpunk, highly detailed, sci-fi",
                    studio: "professional studio photography, high end retouching, 8k",
                    anime: "anime masterpiece, makoto shinkai style, vibrant colors",
                    dark: "dark fantasy, grimdark, volumetric lighting, moody"
                };
                newPrompt = `${newPrompt}, ${styles[modifier] || modifier}`;
            }

            // Apply advanced tools modifiers
            if (action === 'tools' && toolValue) {
                const tools: Record<string, string> = {
                    genius: "highly creative genius concept, surreal, magical, masterpiece",
                    summon_prism: "mythical realm, prismatic crystals, rainbow lighting, god rays",
                    strength_low: "subtle exact features",
                };
                newPrompt = `${newPrompt}, ${tools[toolValue] || toolValue}`;
                if (toolValue === 'strength_low') {
                    dispatchSteps = 4; // Fewer steps for less distortion
                }
            }

            await this.dispatchRemixJob(interaction, originalInteractionId, imageIndex, newPrompt, dispatchCount, dispatchSteps, imageUrl);

        } catch (err: any) {
            logger.error(`Remix logic failed`, err);
            await interaction.reply({ content: `❌ **Remix Error:** ${err.message}` });
        }
    }

    private async dispatchRemixJob(interaction: HiveProxyInteraction, originalInteractionId: string, imageIndex: number, newPrompt: string, count: number, numSteps: number, cachedImageUrl?: string) {
        if (!interaction.interaction.deferred && !interaction.interaction.replied) {
            await interaction.defer({ ephemeral: true });
        }

        try {
            let imageUrl = cachedImageUrl;
            if (!imageUrl) {
                const data = await hivePersistence.getGeneration(originalInteractionId);
                imageUrl = data?.urls?.[imageIndex];
            }
            if (!imageUrl) throw new Error('Could not resolve image URL for Remix.');

            const mission: MissionProfile = {
                category: "Remix",
                description: "Universal Modal Edit Request",
                cost: 6 * count, // vibes grid costs more!
                prompt: newPrompt,
                safetyDepth: 'STANDARD'
            };

            await this.orchestrate(interaction, mission, async (ab) => {
                const payload: GenerationTask = {
                    interactionId: interaction.id,
                    prompt: mission.prompt!,
                    modelId: 'flux-klein-4b',
                    discordId: interaction.user.id,
                    channelId: interaction.channel!.id,
                    guildId: interaction.guildId || undefined,
                    createdAt: Date.now(),
                    imageUrl,
                    count,
                    numSteps
                };

                await this.enqueueGeneration(payload);
                await interaction.reply(HiveUX.createSuccessEmbed("Remix Enqueued!", "Your hive worker is fetching nectars and compiling visions..."));
            });

        } catch (err: any) {
            logger.error(`Remix dispatch failed`, err);
            await interaction.reply({ content: `❌ **Remix Error:** ${err.message}` });
        }
    }

    // --- Processor logic (Consolidated from GenerationService) ---
    async enqueueGeneration(payload: any) {
        if (this.isCircuitOpen('generation')) {
            throw new Error('SYSTEM_DEGRADED: Generation service temporarily offline.');
        }

        const project = this.config.GCLOUD_PROJECT;
        const location = this.config.CLOUD_TASKS_LOCATION;
        const queue = this.config.CLOUD_TASKS_QUEUE;
        const url = this.config.TASK_WEBHOOK_URL;
        
        await hivePersistence.saveGeneration(payload.interactionId, payload);

        try {
            if (!project || !location || !queue || !url) {
                throw new Error("Cloud Tasks Configuration Missing");
            }

            const parent = cloudTasksClient.queuePath(project, location, queue);
            const task = {
                httpRequest: {
                    httpMethod: 'POST' as const,
                    url: url,
                    headers: { 'Content-Type': 'application/json' },
                    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
                    oidcToken: {
                        serviceAccountEmail: this.config.CLOUD_TASKS_SA_EMAIL || `${project}@appspot.gserviceaccount.com`,
                        audience: url
                    },
                },
            };

            const createTaskPromise = cloudTasksClient.createTask({ parent, task });
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Connection Timeout")), 4000);
            });

            await Promise.race([createTaskPromise, timeoutPromise]);
            logger.info(`[HIVE] Enqueued mission to Cloud Tasks: ${payload.interactionId}`);
        } catch (err: any) {
            logger.warn(`[HIVE] Cloud Tasks Error: ${err.message}. Falling back to direct Modal execution for ${payload.interactionId}`);
            
            // Simulate webhook claim and execute
            try {
                const claim = await hivePersistence.claimTask(payload.interactionId);
                if (claim.success) {
                    this.executeGeneration(payload).catch(execErr => {
                        logger.error(`[WORKER] Direct Execution Failed: ${payload.interactionId}`, execErr);
                    });
                }
            } catch (claimErr: any) {
                 logger.error(`[WORKER] Failed to claim task for fallback execution: ${payload.interactionId}`, claimErr);
            }
        }
    }

    // --- Server & Maintenance ---
    private initializeServer() {
        this.server = http.createServer(async (req, res) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname === '/healthz') return this.handleHealthCheck(res);
        if (req.method === 'POST' && url.pathname === '/tasks/process-generation') return this.handleTaskWebhook(req, res);
        res.writeHead(404).end();
        });
        this.server.listen(this.config.PORT || 8080);
    }

    // --- Resident Check (Consolidated from lib/hive.js) ---
    async isResiding(userId: string): Promise<boolean> {
        const targetGuildId = this.config.DREAMBEES_GUILD_ID;
        try {
            const guild = this.client.guilds.cache.get(targetGuildId) || await this.client.guilds.fetch(targetGuildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(userId).catch(() => null);
                return !!member;
            }
        } catch (err) {
            logger.error(`Hive residency check failed for ${userId}`, err);
        }
        return false;
    }

    private async handleTaskWebhook(req: http.IncomingMessage, res: http.ServerResponse) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                // 1. OIDC Identity Verification
                const isDevelopment = this.config.NODE_ENV === 'development';
                const authHeader = req.headers['authorization'];
                
                if (isDevelopment && !authHeader) {
                    logger.info('[WORKER] Dev Mode: Bypassing OIDC verification');
                } else {
                    if (!authHeader?.startsWith('Bearer ')) {
                        logger.warn('[WORKER] Missing OIDC Token');
                        res.writeHead(401).end('Unauthorized');
                        return;
                    }

                    const idToken = authHeader.split(' ')[1];
                    // Normalize audience: match exactly what Cloud Tasks sends or what's in config
                    // We also strip trailing slashes to avoid common configuration mismatches
                    const configAudience = this.config.TASK_WEBHOOK_URL.replace(/\/$/, '');
                    
                    try {
                        const ticket = await this.authClient.verifyIdToken({
                            idToken,
                            audience: [configAudience, this.config.TASK_WEBHOOK_URL]
                        });
                        
                        const payload = ticket.getPayload();
                        if (process.env.NODE_ENV === 'production' && this.config.CLOUD_TASKS_SA_EMAIL) {
                            if (payload?.email !== this.config.CLOUD_TASKS_SA_EMAIL) {
                                throw new Error(`Identity Mismatch: Expected ${this.config.CLOUD_TASKS_SA_EMAIL}, got ${payload?.email}`);
                            }
                        }
                    } catch (oidcErr: any) {
                        logger.error('[WORKER] Auth Failure', { 
                            error: oidcErr.message,
                            configuredAudience: configAudience,
                            env: process.env.NODE_ENV
                        });
                        res.writeHead(403).end(`Forbidden: ${oidcErr.message}`);
                        return;
                    }
                }

                // 2. Process Payload
                const payload = JSON.parse(body) as GenerationTask;
                
                // 3. Atomic Task Claim (Idempotency)
                const claim = await hivePersistence.claimTask(payload.interactionId);
                if (!claim.success) {
                    logger.info(`[WORKER] Idempotency Intercept: ${payload.interactionId} (${claim.reason})`);
                    res.writeHead(200).end(JSON.stringify({ status: 'already_processing_or_completed' }));
                    return;
                }

                logger.info(`[WORKER] Hive Task Claimed: ${payload.interactionId}`);
                
                // 4. Background Execution
                this.executeGeneration(payload).catch(err => {
                    logger.error(`[WORKER] Background Mission Failed: ${payload.interactionId}`, err);
                });
                
                res.writeHead(200).end(JSON.stringify({ status: 'queued_for_processing' }));
            } catch (err: any) {
                logger.error(`[WORKER] Webhook Pipeline Error`, err);
                res.writeHead(400).end(JSON.stringify({ error: 'Invalid Payload' }));
            }
        });
    }

    /**
     * WORKER PIPELINE: The Hive's active labor force.
     * Transitions from Core orchestration to Infrastructure execution.
     */
    private async executeGeneration(task: GenerationTask) {
        return workerLimit(async () => {
            const { interactionId, discordId, channelId } = task;
            
            try {
                // 1. GENERATION: Generate via AI Model or Remix via Modal Edit
                logger.info(`[WORKER] Calling AI Model for Mission: ${interactionId}`);
                
                let result;
                if (task.imageUrl) {
                    result = await this.hiveGenerator.remix(task, task.imageUrl);
                } else {
                    result = await this.hiveGenerator.generate(task);
                }

                if (result.status === 'failed') {
                    throw new Error(result.error || 'AI Generation Failed');
                }

                // 2. PLUMBING: Stitch buffers
                logger.info(`[WORKER] Processing Nectar for Mission: ${interactionId}`);
                const buffers = result.images.map(b64 => Buffer.from(b64, 'base64'));
                const stitched = await HiveGenerator.stitch(buffers);

                // 3. CORE/UI: Discord Delivery
                const attachment = new AttachmentBuilder(stitched, { name: `harvested_${interactionId.slice(-6)}.webp` });
                const channel = await this.client.channels.fetch(channelId).catch(() => null);
                
                if (channel && 'send' in channel) {
                    const components = [];
                    if (result.images.length > 1) {
                        components.push(HiveUX.createUpscaleRow(interactionId, result.images.length));
                    } else if (result.images.length === 1) {
                        components.push(HiveUX.createUpscaleRow(interactionId, 1));
                    }
                    components.push(HiveUX.createModRow(interactionId));

                    await (channel as any).send({ 
                        content: `🐝 **Harvest Complete!** <@${discordId}>, your vision from the hive:`, 
                        files: [attachment],
                        components
                    });
                }

                // 4. INFRASTRUCTURE: Update State
                const genRef = hivePersistence.collection(COLLECTIONS.GENERATIONS).doc(interactionId);
                await hivePersistence.setDocCompat(genRef, {
                    status: 'completed',
                    resolvedAt: hivePersistence.fieldValue.serverTimestamp()
                }, { merge: true });

                logger.info(`[WORKER] Mission Accomplished: ${interactionId}`);

            } catch (err: any) {
                logger.error(`[WORKER] Mission Failure: ${interactionId}`, err);
                
                // Autonomous Refund & State Update
                const genRef = hivePersistence.collection(COLLECTIONS.GENERATIONS).doc(interactionId);
                await hivePersistence.setDocCompat(genRef, {
                    status: 'failed',
                    error: err.message
                }, { merge: true });

                const refunded = await hivePersistence.refund(interactionId, `Worker Failure: ${err.message}`);
                if (refunded) {
                    logger.info(`[WORKER] Autonomous Refund Issued for ${interactionId}`);
                    const channel = await this.client.channels.fetch(channelId).catch(() => null);
                    if (channel && 'send' in channel) {
                        await (channel as any).send(`⚠️ **Worker Lost in the Fields:** Your mission failed, but your Zaps have been returned. Reason: \`${err.message}\``);
                    }
                }
            }
        });
    }

    private isCircuitOpen(service: 'generation') {
        const s = this.breakers[service];
        if (s.status === 'OPEN') {
            if (Date.now() - s.lastFailure > 45000) {
                s.status = 'HALF-OPEN';
                return false;
            }
            return true;
        }
        return false;
    }

    private async handleHealthCheck(res: http.ServerResponse) {
        res.writeHead(200).end(JSON.stringify({ status: 'UP', uptime: process.uptime() }));
    }

    // --- API Integration (Consolidated from lib/api/dreambees.js) ---
    async fetchImageDetail(imageId: string) {
        const url = `${this.config.DREAMBEES_API_URL}`;
        const key = this.config.DREAMBEES_API_KEY;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
                body: JSON.stringify({ data: { action: 'getImageDetail', imageId } })
            });
            if (!response.ok) return null;
            const data: any = await response.json();
            return data.result;
        } catch (err) {
            logger.error(`Failed to fetch image detail for ${imageId}`, err);
            return null;
        }
    }

    async fetchBuffer(url: string, signal?: AbortSignal) {
        let retries = 3;
        while (retries > 0) {
            if (signal?.aborted) return null;
            try {
                const response = await fetch(url, { signal });
                if (response.ok) return Buffer.from(await response.arrayBuffer());
            } catch (err) {
                if (retries === 1) throw err;
            }
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, 1000));
        }
        return null;
    }

    async syncToWebApp(data: any) {
        const url = this.config.DREAMBEES_API_URL;
        const key = this.config.DREAMBEES_API_KEY;
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
                body: JSON.stringify({ data })
            });
        } catch (err) {
            logger.error(`Failed to sync to web app`, err);
        }
    }

    private async loadExtensions() {
        const commandsPath = path.join(__dirname, '../commands');
        if (fs.existsSync(commandsPath)) {
            for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') || f.endsWith('.ts'))) {
                const commandModule = await import(`file://${path.join(commandsPath, file)}`);
                // Commands are named exports!
                for (const key of Object.keys(commandModule)) {
                    const cmd = commandModule[key];
                    if (cmd && cmd.data && cmd.execute) {
                        this.commands.set(cmd.data.name, cmd);
                        logger.info(`[HiveEngine] Loaded command: ${cmd.data.name}`);
                    }
                }
            }
        }
    }


    private setupProcessHandlers() {
        process.on('SIGINT', () => this.shutdown('SIGINT'));
        process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    }

    private startMaintenance() {
        setInterval(() => hivePersistence.recoverZombies(), 15 * 60 * 1000);
    }

    async shutdown(signal: string) {
        if (this.server) this.server.close();
        await hivePersistence.close();
        this.client.destroy();
        process.exit(0);
    }
}
