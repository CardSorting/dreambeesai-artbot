import { Client, GatewayIntentBits, Collection, Events, ActivityType } from 'discord.js';
import http from 'http';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';
import { cleanupStaleLocks, recoverZombieTransactions, getStudioThreadId, setStudioThreadId, db } from './lib/db.js';
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
    const interactionLogger = logger.child({
        interactionId: interaction.id,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId
    });

    try {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            activeJobs.add(interaction.id);
            
            // Enforce thread-only restriction for image generation with seamless transition
            if (command.category === 'image' && !interaction.channel.isThread()) {
                const permissions = interaction.appPermissions;
                if (permissions && (!permissions.has('CreatePublicThreads') || !permissions.has('SendMessagesInThreads'))) {
                    return await interaction.reply({ 
                        content: '❌ **Permissions Error:** I need permission to create threads and send messages in them to work seamlessly in this channel. Please ask an admin to check my permissions!', 
                        ephemeral: true 
                    });
                }

                try {
                    // SEAMLESS ART STUDIO REUSE LOGIC
                    // Use database-backed lookup for maximum reliability
                    const storedThreadId = await getStudioThreadId(interaction.user.id, interaction.channelId);
                    let thread = null;
                    
                    if (storedThreadId) {
                        thread = await interaction.channel.threads.fetch(storedThreadId).catch(() => null);
                    }

                    // Fallback to name-based lookup if DB lookup failed (e.g. initial migration or DB issue)
                    if (!thread) {
                        const allThreads = await interaction.channel.threads.fetch();
                        thread = allThreads.threads.find(t => 
                            t.ownerId === interaction.client.user.id && 
                            t.name.includes(`${interaction.user.username}'s Art Studio`)
                        );
                    }

                    let isNewThread = false;
                    if (!thread) {
                        const threadName = `🎨 ${interaction.user.username}'s Art Studio`;
                        thread = await interaction.channel.threads.create({
                            name: threadName,
                            autoArchiveDuration: 60,
                            reason: 'Seamless art studio creation'
                        });
                        isNewThread = true;
                        // Save the new thread ID to the database
                        await setStudioThreadId(interaction.user.id, interaction.channelId, thread.id);
                    } else if (thread.archived) {
                        await thread.setArchived(false, 'Re-opening studio for new generation');
                    }

                    const threadedInteraction = new ThreadedInteraction(interaction, thread);
                    
                    await interaction.reply({ 
                        content: `✅ **Drawing Room Ready!** I've ${isNewThread ? 'created' : 'opened'} your personal Art Studio: ${thread.toString()}`, 
                        ephemeral: true 
                    });

                    if (isNewThread) {
                        await thread.send({
                            content: `Welcome to your **Art Studio**, ${interaction.user.toString()}! 🎨\nAll your generations in this channel will be tucked away here to keep things tidy.`
                        });
                    }

                    return await command.execute(threadedInteraction);
                } catch (e) {
                    logger.error("Failed to create seamless thread", e);
                    return await interaction.reply({ 
                        content: '❌ **Threads Only!** Please create a thread to start creating! (Automatic thread creation failed)', 
                        ephemeral: true 
                    });
                }
            }

            await command.execute(interaction);
        } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
            const matchedPrefix = Array.from(client.buttonInteractions.keys()).find(prefix => interaction.customId.startsWith(prefix));
            
            if (matchedPrefix) {
                const handler = client.buttonInteractions.get(matchedPrefix);
                activeJobs.add(interaction.id);
                await handler.execute(interaction);
            }
        }
    } catch (error) {
        interactionLogger.error(`Unhandled interaction error`, error);
        
        const errorMessage = { content: '❌ **Bot Error:** Something went wrong while processing your request. Please try again later.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(errorMessage).catch(() => {});
        } else {
            await interaction.reply(errorMessage).catch(() => {});
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
    const server = http.createServer((req, res) => {
        // Only return 200 if the Discord client is actually logged in and ready
        // Give a 30-second grace period for initial connection
        if (client.isReady() || (Date.now() - startTime < 30000)) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('DreamBees Hive: ONLINE 🐝');
        } else {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('DreamBees Hive: STARTING/RECONNECTING... ⏳');
            logger.warn('Health check failed: Discord client not ready after grace period');
        }
    }).listen(port, () => {
        logger.info(`Health check server listening on port ${port}`);
    });

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

