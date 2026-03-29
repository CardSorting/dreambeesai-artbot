import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
const commandsPath = path.join(__dirname, '../dist/commands');

if (!fs.existsSync(commandsPath)) {
    console.error(`ERROR: Commands path not found at ${commandsPath}. Did you run 'npm run build'?`);
    process.exit(1);
}

const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const commandModule = await import(`file://${filePath}`);
    
    for (const key of Object.keys(commandModule)) {
        const command = commandModule[key];
        if (command && 'data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`[PREP] Loaded command: ${command.data.name}`);
        }
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        const data = await rest.put(
            process.env.DREAMBEES_GUILD_ID 
                ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DREAMBEES_GUILD_ID)
                : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();
