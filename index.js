// --- SYSTEM DEFAULTS ---
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '8080';

console.log('--- SYSTEM BOOT ---');
console.log('Environment:', { 
    NODE_ENV: process.env.NODE_ENV, 
    PORT: process.env.PORT,
    PID: process.pid,
    Node: process.version,
    Platform: process.platform
});

import { Client, GatewayIntentBits, Collection, Events, ActivityType } from 'discord.js';
import http from 'http';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOrCreateDiscordUser } from './lib/db/users.js';
import { toSafeNumber } from './lib/utils.js';

// --- TELEMETRY BINDING ---
const systemContext = {
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    env: process.env.NODE_ENV
};
const globalLogger = logger.child(systemContext);
let isInitialized = false;

console.log('--- STARTING DREAMBEES BOT ---');

import { isCircuitOpen } from './lib/api/dreambees.js';
import { HiveInteraction } from './lib/discord-ux.js';

// --- CONFIGURATION ---
import { validateConfig, CONFIG } from './lib/config-check.js';
validateConfig();
// ---------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logic moved to lib/config-check.js


function startHeartbeat(activeJobs) {
    logger.info('Starting production heartbeat monitor...');
    setInterval(() => {
        const memory = process.memoryUsage();
        const uptime = process.uptime();
        const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
        
        logger.info('[Heartbeat] System Health', {
            activeJobs: activeJobs.size,
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
            rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
            heapUsed: `${heapUsedMb}MB`,
            external: `${Math.round(memory.external / 1024 / 1024)}MB`,
            cpu: process.cpuUsage()
        });

        // RESOURCE GUARD: Warn if memory is dangerously high (> 1GB)
        if (heapUsedMb > 1024) {
            logger.warn('HIGH_MEMORY_USAGE_DETECTED', { heapUsedMb });
        }
    }, 15 * 60 * 1000); // Every 15 minutes
}

/**
 * Phase 11: Job Registry Hygiene
 * Prunes the activeJobs Map to prevent memory leaks from hanging interactions.
 */
function startSanityMonitor(activeJobs) {
    globalLogger.info('Starting job sanity monitor (Active Job Pruning)...');
    setInterval(() => {
        const now = Date.now();
        const MAX_JOB_AGE = 10 * 60 * 1000; // 10 Minutes
        let pruned = 0;

        for (const [id, job] of activeJobs.entries()) {
            if (job.createdAt && (now - job.createdAt > MAX_JOB_AGE)) {
                globalLogger.warn(`Pruning stale job: ${id}`, { age: now - job.createdAt });
                if (job.controller) job.controller.abort();
                activeJobs.delete(id);
                pruned++;
            }
        }
        if (pruned > 0) globalLogger.info(`Sanity monitor pruned ${pruned} stale jobs.`);
    }, 5 * 60 * 1000); // Run every 5 minutes
}

// --- GLOBAL PROCESS HARDENING ---
process.on('unhandledRejection', (reason, promise) => {
    const context = {
        uptime: `${Math.floor(process.uptime() / 60)}m`,
        memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        activeJobs: activeJobs.size,
        lastInteractions,
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : null
    };
    logger.error('CRITICAL: UNHANDLED PROMISE REJECTION', context);
});

process.on('uncaughtException', (error) => {
    const context = {
        uptime: `${Math.floor(process.uptime() / 60)}m`,
        memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        activeJobs: activeJobs.size,
        lastInteractions,
        message: error.message,
        stack: error.stack
    };
    logger.error('CRITICAL: UNCAUGHT EXCEPTION — Hive Emergency Shutdown Initiating...', context);
    // Give logger time to flush, then exit (systemd/Docker will restart us)
    setTimeout(() => process.exit(1), 3000);
});
// --------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

const activeJobs = new Map(); // interactionId -> AbortController
const lastInteractions = []; // Tracking the last 5 IDs for forensic analysis

client.commands = new Collection();
const commands = [];

// Load Commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = await import(`file://${filePath}`);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
            logger.info(`Loaded command: ${command.data.name}`);
        } else {
            logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// Load Interactions
client.buttonInteractions = new Collection();
const interactionsPath = path.join(__dirname, 'interactions');
if (fs.existsSync(interactionsPath)) {
    const interactionFiles = fs.readdirSync(interactionsPath).filter(file => file.endsWith('.js'));
    for (const file of interactionFiles) {
        const filePath = path.join(interactionsPath, file);
        const interaction = await import(`file://${filePath}`);
        if ('customIdPrefix' in interaction && 'execute' in interaction) {
            client.buttonInteractions.set(interaction.customIdPrefix, interaction);
        }
    }
}

import { OAuth2Client } from 'google-auth-library';
import { processGenerationTask } from './lib/queue/processor.js';

const authClient = new OAuth2Client();

async function verifyOidcToken(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.split(' ')[1];

    try {
        const expectedAudience = process.env.TASK_WEBHOOK_URL || `${process.env.WEBAPP_URL}/tasks/process-generation`;
        const ticket = await authClient.verifyIdToken({
            idToken: token,
            audience: expectedAudience
        });
        const payload = ticket.getPayload();
        
        // PRODUCTION HARDENING: Identity Locking
        const isGoogleIssuer = (payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com');
        const isAuthorizedEmail = !process.env.CLOUD_TASKS_SA_EMAIL || payload.email === process.env.CLOUD_TASKS_SA_EMAIL;
        
        if (!isGoogleIssuer || !payload.email_verified || !isAuthorizedEmail) {
            logger.warn("OIDC Identity Mismatch", { 
                iss: payload.iss, 
                email: payload.email, 
                email_verified: payload.email_verified,
                expected: process.env.CLOUD_TASKS_SA_EMAIL 
            });
            return false;
        }
        return true;
    } catch (e) {
        logger.error("OIDC Verification Failed", { error: e.message });
        return false;
    }
}

/**
 * FORTRESS GUARD: Standardized Webhook Payload Validation
 */
function validateTaskPayload(payload) {
    const required = ['requestId', 'prompt', 'modelId', 'userId', 'discordId'];
    const missing = required.filter(field => !payload[field]);
    if (missing.length > 0) return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
    
    // Type and Boundary checks
    if (typeof payload.requestId !== 'string' || payload.requestId.length < 5) return { valid: false, error: 'requestId must be a valid string' };
    if (typeof payload.prompt !== 'string' || payload.prompt.trim().length < 3) return { valid: false, error: 'prompt too short or invalid' };
    if (payload.prompt.length > 2000) return { valid: false, error: 'prompt exceeds maximum length (2000 chars)' };
    
    return { valid: true };
}

client.once('ready', async () => {
    logger.info(`Logged in as ${client.user.tag}! Slash commands should be registered via scripts/register-commands.js`);

    // Cleanup any hung locks and recover zombie transactions from previous sessions
    try {
        const cleaned = await cleanupStaleLocks();
        if (cleaned > 0) logger.info(`Cleaned up ${cleaned} stale locks on startup.`);

        const recovered = await recoverZombieTransactions();
        if (recovered > 0) logger.info(`Successfully recovered ${recovered} zombie wallet transactions.`);
    } catch (e) {
        logger.error("Startup maintenance failed", e);
    }
});

client.on(Events.Error, (error) => {
    logger.error('Discord Client Error', { error: error.message, stack: error.stack });
});

client.on(Events.Warn, (info) => {
    logger.warn('Discord Client Warning', { info });
});

client.on('rateLimit', (rateLimitData) => {
    logger.warn('Discord Rate Limit Encountered', {
        timeout: rateLimitData.timeout,
        limit: rateLimitData.limit,
        method: rateLimitData.method,
        path: rateLimitData.path,
        route: rateLimitData.route,
        global: rateLimitData.global
    });
});

export async function handleInteraction(interaction, client, activeJobs) {
    // Forensic tracking
    lastInteractions.push({ id: interaction.id, type: interaction.type, user: interaction.user.tag, timestamp: new Date().toISOString() });
    if (lastInteractions.length > 5) lastInteractions.shift();

    const ctxLogger = logger.child({
        interactionId: interaction.id,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId
    });

    try {
        const photoURL = interaction.user ? interaction.user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
        const userId = interaction.user?.id;
        const userTag = interaction.user?.tag;
        const guild = interaction.guild;
        const member = interaction.member;
        
        if (!userId) throw new Error("Interaction missing user profile context");

        await getOrCreateDiscordUser(userId, userTag, photoURL)
            .catch(err => ctxLogger.error("Identity Provisioning Failed", err));

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            const controller = new AbortController();
            activeJobs.set(interaction.id, { controller, createdAt: Date.now() });
            const hiveInteraction = new HiveInteraction(interaction);

            // Category-Aware Deferral Strategy:
            // - Image commands: Defer as public (will be redirected to thread or shown publicly)
            // - Utility/Admin commands: Handle their own deferral/reply internally
            if (command.category === 'image') {
                // 1. EPHEMERAL DEFER for image commands (keep failures out of the channel)
                await hiveInteraction.deferReply({ ephemeral: true }).catch(err => ctxLogger.error("Global Defer Failed", err));

                // 2. THREADED REDIRECT (Seamless Art Studio)
                if (!interaction.channel || !interaction.channel.isThread()) {
                    const permissions = interaction.appPermissions;
                    if (permissions && (!permissions.has('CreatePublicThreads') || !permissions.has('SendMessagesInThreads'))) {
                        return await interaction.editReply({
                            content: '❌ **Permissions Error:** I need permission to create threads to work seamlessly!',
                        });
                    }

                    try {
                        // Optimized Fetch: Check Firestore first, then target fetch
                        let thread = null;
                        const storedThreadId = await getStudioThreadId(interaction.user.id, interaction.channelId);

                        if (storedThreadId) {
                            try {
                                thread = await interaction.channel.threads.fetch(storedThreadId);
                            } catch (e) {
                                ctxLogger.warn("Stored studio thread no longer exists or is unreachable", { storedThreadId, error: e.message });
                                thread = null;
                            }
                        }

                        if (!thread) {
                            // Use fetchActive instead of a full fetch to be faster
                            const activeThreads = await interaction.channel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                            thread = activeThreads.threads.find(t => t.ownerId === interaction.client.user.id && t.name.includes(`${interaction.user.username}'s Art Studio`));
                        }

                        if (!thread) {
                            try {
                                thread = await interaction.channel.threads.create({
                                    name: `🎨 ${interaction.user.username}'s Art Studio`,
                                    autoArchiveDuration: 60,
                                    reason: 'DreamBees Personal Art Studio'
                                });
                                await setStudioThreadId(interaction.user.id, interaction.channelId, thread.id);
                                await thread.send({ 
                                    content: `Welcome to your **Art Studio**, ${interaction.user.toString()}! 🎨\n\n> **Advisory:** Experimental AI content. Please ensure all creations align with community safety standards.` 
                                });
                            } catch (err) {
                                if (err.code === 50013) {
                                    ctxLogger.warn("Missing permissions to create threads in this channel", { channelId: interaction.channelId });
                                    await interaction.editReply({ content: "⚠️ **Note:** I don't have permission to open your private Art Studio here, so I'll post your results right in this channel!" });
                                    thread = null;
                                } else {
                                    throw err;
                                }
                            }
                        } else if (thread.archived) {
                            await thread.setArchived(false);
                        }

                        // Attach the thread to our interaction proxy (if created/found)
                        if (thread) hiveInteraction.thread = thread;

                        // Give a warm greeting if we (re)opened the studio
                        if (thread && !interaction.replied) {
                            await interaction.editReply({ content: `✅ **Drawing Room Ready!** I've opened your Art Studio: ${thread.toString()}` });
                        }
                    } catch (e) {
                        ctxLogger.error("Failed to provision seamless thread", e);
                    }
                }
            }
            // Utility/admin commands (claim, status, config) manage their own deferral

            return await command.execute(hiveInteraction, { logger: ctxLogger, jobs: activeJobs, signal: controller.signal });

        } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
            const matchedPrefix = Array.from(client.buttonInteractions.keys()).find(prefix => interaction.customId.startsWith(prefix));

            if (matchedPrefix) {
                const handler = client.buttonInteractions.get(matchedPrefix);
                const controller = new AbortController();
                activeJobs.set(interaction.id, { controller, createdAt: Date.now() });
                // Standardize lifecycle with proxy
                const hiveInteraction = new HiveInteraction(interaction);
                return await handler.execute(hiveInteraction, { logger: ctxLogger, jobs: activeJobs, signal: controller.signal });
            }
        }
    } catch (error) {
        ctxLogger.error('Interaction processing failed', { 
            error: error.message, 
            stack: error.stack,
            customId: interaction.customId || 'slash',
            interactionId: interaction.id,
            user: interaction.user.tag
        });

        const errorMessage = { content: Hive.Voice.failure, ephemeral: true };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMessage).catch(() => { });
        } else {
            if (interaction.isRepliable()) {
                await interaction.reply(errorMessage).catch(() => { });
            }
        }
    } finally {
        activeJobs.delete(interaction.id);
    }
}

client.on('interactionCreate', async interaction => {
    if (!isInitialized) {
        logger.warn('Discarding interaction: System not yet initialized.');
        return;
    }
    await handleInteraction(interaction, client, activeJobs);
});

if ((!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) && import.meta.url === `file://${process.argv[1]}`) {
    logger.warn("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env file. Bot cannot start.");
} else if (import.meta.url === `file://${process.argv[1]}` || process.env.NODE_ENV === 'production') {
    const isHealthy = await verifyConnectivity();
    if (!isHealthy) {
        logger.error("FATAL: Database connectivity check failed on startup. Exiting.");
        process.exit(1);
    }

    startHeartbeat(activeJobs);
    startSanityMonitor(activeJobs);

    // Robust HTTP Server for Cloud Run Health Checks
    const port = process.env.PORT || 8080;
    const startTime = Date.now();
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        
        // 1. Task Queue Webhook (Google Cloud Tasks)
        if (req.method === 'POST' && url.pathname === '/tasks/process-generation') {
            const isAuthorized = await verifyOidcToken(req);
            if (!isAuthorized && process.env.NODE_ENV === 'production') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Unauthorized Task Delivery' }));
            }

            let body = '';
            let bodySize = 0;
            const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB Hard Limit

            req.on('data', chunk => { 
                bodySize += chunk.length;
                if (bodySize > MAX_BODY_SIZE) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Payload Too Large' }));
                    req.destroy();
                    return;
                }
                body += chunk; 
            });

            req.on('end', async () => {
                if (res.writableEnded) return;
                try {
                    const payload = JSON.parse(body);
                    const validation = validateTaskPayload(payload);
                    
                    if (!validation.valid) {
                        logger.warn(`[CloudTasks] Invalid Task Payload`, { error: validation.error, bodyExcerpt: body.substring(0, 100) });
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: validation.error }));
                    }

                    const requestId = payload.requestId;
                    logger.info(`[CloudTasks] Webhook received task: ${requestId}`);

                    const queueRef = db.collection(COLLECTIONS.GENERATION_QUEUE).doc(requestId);
                    await queueRef.update({ 
                        status: 'processing', 
                        startedAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }).catch(() => {});

                    const result = await processGenerationTask(payload, { 
                        logger: logger.child({ requestId, source: 'CloudTasks' })
                    });

                    // ROUND TRIP REDUCTION: Only update if the processor didn't already do it in a consolidated batch
                    if (!result._alreadyUpdated) {
                        await queueRef.update({
                            ...result,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        }).catch(() => {});
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'completed', requestId }));
                } catch (err) {
                    logger.error(`[CloudTasks] Webhook processing failed`, { error: err.message });
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // 2. Health Checks
        if (url.pathname === '/healthz' || url.pathname === '/') {
            const isClientReady = client.isReady() || (Date.now() - startTime < 30000);
            const isApiHealthy = !isCircuitOpen();

            // Non-blocking DB Check with timeout and REAL write-read verification
            let isDbHealthy = true;
            let dbDetails = 'OK';
            if (client.isReady()) {
                const dbCheckPromise = (async () => {
                    const probeRef = db.collection('_health').doc('probe');
                    // Perform a lightweight write-read to verify full Firestore connectivity
                    await probeRef.set({ 
                        lastCheck: admin.firestore.FieldValue.serverTimestamp(),
                        node: process.env.HOSTNAME || 'local-mac'
                    });
                    const snap = await probeRef.get();
                    return snap.exists;
                })();
    
                const timeoutPromise = new Promise(r => setTimeout(() => r('TIMEOUT'), 3000));
                const result = await Promise.race([dbCheckPromise, timeoutPromise]);
                if (result === 'TIMEOUT') {
                    isDbHealthy = false;
                    dbDetails = 'TIMEOUT';
                } else if (!result) {
                    isDbHealthy = false;
                    dbDetails = 'READ_FAIL';
                }
            }
    
            const isHealthy = isClientReady && isApiHealthy && isDbHealthy;
    
            if (isHealthy) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'UP',
                    uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
                    memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
                    activeJobs: activeJobs.size,
                    node: process.env.HOSTNAME || 'local-mac',
                    dependencies: { discord: 'OK', api: 'OK', db: 'OK' }
                }));
            } else {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'DOWN',
                    reason: !isClientReady ? 'Discord Not Ready' : (!isApiHealthy ? 'API Circuit Open' : `Database Error: ${dbDetails}`),
                    dependencies: {
                        discord: isClientReady ? 'OK' : 'ERR',
                        api: isApiHealthy ? 'OK' : 'ERR',
                        db: dbDetails
                    }
                }));
                logger.warn('Production health check failed', { isClientReady, isApiHealthy, isDbHealthy, dbDetails });
            }
        } else {
            res.writeHead(404);
            res.end();
        }
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.error(`Port ${port} is already in use. Please kill the existing process and restart.`);
            process.exit(1);
        } else {
            logger.error('HTTP Server Error', err);
        }
    }).listen(port, () => {
        logger.info(`Dependency-aware health probe & Task Webhook listening on port ${port}`);
    });

    // HARDENING: Increase server timeout to 5 minutes to accommodate long-running Cloud Task generations
    server.timeout = 300000;
    server.keepAliveTimeout = 305000; 

    // 5. Cleanup Heartbeat (Every 15 Minutes)
    setInterval(async () => {
        try {
            logger.info("Heartbeat: Running proactive maintenance...");
            const recovered = await recoverZombieTransactions();
            const locksCleaned = await cleanupStaleLocks();
            if (recovered > 0 || locksCleaned > 0) {
                logger.info("Maintenance complete", { recovered, locksCleaned });
            }
        } catch (err) {
            logger.error("Maintenance heartbeat failed", err);
        }
    }, 15 * 60 * 1000);

    // Duplicate handlers removed, logic moved to global section above.

    // Discord.js client-level error handlers
    client.on('error', (error) => {
        logger.error('Discord.js Client Error', error);
    });

    client.on('warn', (message) => {
        logger.warn('Discord.js Client Warning', { message });
    });

    // Login with hard timeout protection
    const loginTimeout = setTimeout(() => {
        logger.error('CRITICAL: Discord login timed out after 30s. Shutting down for restart.');
        process.exit(1);
    }, 30000);

    client.login(process.env.DISCORD_TOKEN).then(() => {
        clearTimeout(loginTimeout);
        isInitialized = true;
        logger.info('Discord login successful.');
        logger.info('----------------------------------------');
        logger.info('   🐝 SYSTEM ONLINE & MISSION READY   ');
        logger.info('----------------------------------------');
    }).catch(err => {
        clearTimeout(loginTimeout);
        logger.error('Discord login failed immediately.', err);
        process.exit(1);
    });

    // Graceful Shutdown
    const shutdown = async (signal) => {
        logger.info(`Received ${signal}. Active jobs: ${activeJobs.size}. Waiting for drainage (up to 60s)...`);

        // Trigger AbortControllers for all active jobs
        for (const [id, job] of activeJobs.entries()) {
            if (job.controller) {
                logger.info(`Aborting task ${id} due to shutdown.`);
                job.controller.abort();
            }
        }

        // Stop taking new interactions
        client.user?.setPresence({ status: 'dnd', activities: [{ name: 'Hive Relocating...', type: ActivityType.Custom }] });

        let waitAttempts = 0;
        while (activeJobs.size > 0 && waitAttempts < 60) {
            await new Promise(r => setTimeout(r, 1000));
            waitAttempts++;
            if (waitAttempts % 10 === 0) logger.info(`Still waiting for ${activeJobs.size} jobs to drain...`);
        }

        if (activeJobs.size > 0) {
            logger.warn(`Shutdown forced while ${activeJobs.size} jobs were still active.`);
        } else {
            logger.info(`All jobs drained. Goodbye!`);
        }

        server.close();
        client.destroy();
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}



