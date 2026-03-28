import { Client, GatewayIntentBits, Collection, Events, ActivityType } from 'discord.js';
import http from 'http';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';
import * as Hive from './lib/hive.js';
import { cleanupStaleLocks, recoverZombieTransactions, getStudioThreadId, setStudioThreadId, db } from './lib/db.js';
import { isCircuitOpen } from './lib/api/dreambees.js';
import { ThreadedInteraction } from './lib/discord-ux.js';

// --- CONFIGURATION ---
import { validateConfig, CONFIG } from './lib/config-check.js';
validateConfig(); 
// ---------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logic moved to lib/config-check.js


function startHeartbeat(activeJobs) {
    setInterval(() => {
        const memory = process.memoryUsage();
        logger.info('Bot Heartbeat', {
            activeJobs: activeJobs.size,
            memory: {
                rss: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
                heapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`
            },
            uptime: `${Math.floor(process.uptime() / 60)} minutes`
        });
    }, 15 * 60 * 1000); // Every 15 minutes
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

const activeJobs = new Set();

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

export async function handleInteraction(interaction, client, activeJobs) {
    const ctxLogger = logger.child({
        interactionId: interaction.id,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId
    });

    try {
        const photoURL = interaction.user.displayAvatarURL({ extension: 'png', size: 256 }) || null;
        await getOrCreateDiscordUser(interaction.user.id, interaction.user.tag, photoURL)
            .catch(err => ctxLogger.error("Identity Provisioning Failed", err));

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            activeJobs.add(interaction.id);
            
            // UNIFORM HIVE PROXY
            let hiveInteraction = null;

            if (command.category === 'image' && !interaction.channel.isThread()) {
                const permissions = interaction.appPermissions;
                if (permissions && (!permissions.has('CreatePublicThreads') || !permissions.has('SendMessagesInThreads'))) {
                    return await interaction.reply({ 
                        content: '❌ **Permissions Error:** I need permission to create threads to work seamlessly!', 
                        ephemeral: true 
                    });
                }

                try {
                    const storedThreadId = await getStudioThreadId(interaction.user.id, interaction.channelId);
                    let thread = null;
                    if (storedThreadId) thread = await interaction.channel.threads.fetch(storedThreadId).catch(() => null);

                    if (!thread) {
                        const allThreads = await interaction.channel.threads.fetch();
                        thread = allThreads.threads.find(t => t.ownerId === interaction.client.user.id && t.name.includes(`${interaction.user.username}'s Art Studio`));
                    }

                    if (!thread) {
                        thread = await interaction.channel.threads.create({ name: `🎨 ${interaction.user.username}'s Art Studio`, autoArchiveDuration: 60 });
                        await setStudioThreadId(interaction.user.id, interaction.channelId, thread.id);
                        await thread.send({ content: `Welcome to your **Art Studio**, ${interaction.user.toString()}! 🎨` });
                    } else if (thread.archived) {
                        await thread.setArchived(false);
                    }

                    hiveInteraction = new HiveInteraction(interaction, thread);
                    await interaction.reply({ content: `✅ **Drawing Room Ready!** I've opened your Art Studio: ${thread.toString()}`, ephemeral: true });
                } catch (e) {
                    ctxLogger.error("Failed to create seamless thread", e);
                    hiveInteraction = new HiveInteraction(interaction); // Fallback to regular but proxied
                }
            } else {
                hiveInteraction = new HiveInteraction(interaction);
            }

            return await command.execute(hiveInteraction, { logger: ctxLogger });

        } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
            const matchedPrefix = Array.from(client.buttonInteractions.keys()).find(prefix => interaction.customId.startsWith(prefix));
            
            if (matchedPrefix) {
                const handler = client.buttonInteractions.get(matchedPrefix);
                activeJobs.add(interaction.id);
                // Wrap component interactions in the safety proxy as well
                const hiveInteraction = new HiveInteraction(interaction);
                await handler.execute(hiveInteraction, { logger: ctxLogger });
            }
        }
    } catch (error) {
        ctxLogger.error('Interaction processing failed', error);
        
        const errorMessage = { content: Hive.Voice.failure, ephemeral: true };
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMessage).catch(() => {});
        } else {
            if (interaction.isRepliable()) {
                await interaction.reply(errorMessage).catch(() => {});
            }
        }
    } finally {
        activeJobs.delete(interaction.id);
    }
}

client.on('interactionCreate', async interaction => {
    await handleInteraction(interaction, client, activeJobs);
});

if ((!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) && import.meta.url === `file://${process.argv[1]}`) {
    logger.warn("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env file. Bot cannot start.");
} else if (import.meta.url === `file://${process.argv[1]}` || process.env.NODE_ENV === 'production') {
    validateConfig();
    startHeartbeat(activeJobs);

    // Robust HTTP Server for Cloud Run Health Checks
    const port = process.env.PORT || 8080;
    const startTime = Date.now();
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname === '/healthz' || url.pathname === '/') {
            const isClientReady = client.isReady() || (Date.now() - startTime < 30000);
            const isApiHealthy = !isCircuitOpen();
            
            // Lightweight DB Check (only if client is ready)
            let isDbHealthy = true;
            if (client.isReady()) {
                try {
                    // Check if we can at least reach the collection shim
                    const healthRef = db.collection('_health').doc('probe');
                    if (!healthRef) isDbHealthy = false;
                } catch (e) {
                    isDbHealthy = false;
                }
            }

            const isHealthy = isClientReady && isApiHealthy && isDbHealthy;

            if (isHealthy) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'UP', dependencies: { discord: 'OK', api: 'OK', db: isDbHealthy ? 'OK' : 'ERR' } }));
            } else {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'DOWN', 
                    reason: !isClientReady ? 'Discord Not Ready' : (!isApiHealthy ? 'API Circuit Open' : 'Database Error'),
                    dependencies: { 
                        discord: isClientReady ? 'OK' : 'ERR', 
                        api: isApiHealthy ? 'OK' : 'ERR', 
                        db: isDbHealthy ? 'OK' : 'ERR' 
                    } 
                }));
                logger.warn('Production health check failed', { isClientReady, isApiHealthy, isDbHealthy });
            }
        } else {
            res.writeHead(404);
            res.end();
        }
    }).listen(port, () => {
        logger.info(`Dependency-aware health probe listening on port ${port}`);
    });

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

    client.login(process.env.DISCORD_TOKEN);

    // Graceful Shutdown
    const shutdown = async (signal) => {
        logger.info(`Received ${signal}. Active jobs: ${activeJobs.size}. Waiting for drainage (up to 30s)...`);
        
        // Stop taking new interactions if possible (Discord.js doesn't have a direct 'pause' but we can flag it)
        client.user?.setPresence({ status: 'dnd', activities: [{ name: 'Hive Relocating...', type: ActivityType.Custom }] });

        let waitAttempts = 0;
        while (activeJobs.size > 0 && waitAttempts < 30) {
            await new Promise(r => setTimeout(r, 1000));
            waitAttempts++;
            if (waitAttempts % 5 === 0) logger.info(`Still waiting for ${activeJobs.size} jobs...`);
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

