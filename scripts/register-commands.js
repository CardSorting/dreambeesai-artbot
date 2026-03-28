import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
const commandsPath = path.join(__dirname, '../commands');

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        // Use file:// prefix for Windows compatibility and ESM
        const command = await import(`file://${filePath}`);
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`[INFO] Loaded command: ${command.data.name}`);
        }
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`[INFO] Started refreshing ${commands.length} application (/) commands.`);

        const REQUIRED_CONFIG = [
            'DISCORD_TOKEN',
            'DISCORD_CLIENT_ID',
            'DREAMBEES_API_URL',
            'DREAMBEES_API_KEY',
            'DREAMBEES_GUILD_ID'
        ];

        const guildId = process.env.DREAMBEES_GUILD_ID;
        const clientId = process.env.DISCORD_CLIENT_ID;

        if (guildId) {
            console.log(`[INFO] Registering commands specifically to GUILD: ${guildId} (Instant propagation)`);
            const data = await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );
            console.log(`[SUCCESS] Successfully reloaded ${data.length} GUILD commands.`);
        } else {
            console.log(`[WARNING] No GUILD_ID specified. Registering commands GLOBALLY (Can take up to 1 hour to update).`);
            const data = await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
            console.log(`[SUCCESS] Successfully reloaded ${data.length} GLOBAL commands.`);
        }
    } catch (error) {
        console.error(`[ERROR] Failed to register commands:`, error);
        process.exit(1);
    }
})();
