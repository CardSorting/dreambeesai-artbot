import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
const commandsPath = path.join(__dirname, '../src/commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const commandModule = await import(`file://${filePath}`);
    
    // Commands are named exports in this project (e.g. export const dream = { data: ... })
    // We'll look for any export that has a 'data' property
    for (const key of Object.keys(commandModule)) {
        const command = commandModule[key];
        if (command && 'data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`[PREP] Loaded command: ${command.data.name}`);
        }
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // The put method is used to fully refresh all commands in the guild with the current set
        // If DREAMBEES_GUILD_ID is provided, we register to that guild specifically (faster for dev)
        // Otherwise, we register globally
        const data: any = await rest.put(
            process.env.DREAMBEES_GUILD_ID 
                ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID!, process.env.DREAMBEES_GUILD_ID)
                : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();
