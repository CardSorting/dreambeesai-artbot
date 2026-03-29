import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

(async () => {
    try {
        const clientId = process.env.DISCORD_CLIENT_ID;
        const guildId = process.env.DREAMBEES_GUILD_ID;

        if (!clientId) {
            console.error('ERROR: DISCORD_CLIENT_ID is not set in .env');
            process.exit(1);
        }

        console.log(`[CLEAN] Starting command cleanup for Client: ${clientId}`);

        // 1. Wipe Global Commands
        console.log('[CLEAN] Wiping all global commands...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log('[CLEAN] Global commands cleared successfully.');

        // 2. Wipe Guild Commands (Optional - if the user wanted a TOTAL wipe)
        /*
        if (guildId) {
            console.log(`[CLEAN] Wiping all guild commands for Guild: ${guildId}...`);
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
            console.log('[CLEAN] Guild commands cleared successfully.');
        }
        */

        console.log('[CLEAN] Cleanup complete. Run "npm run register" to re-sync to your desired location.');
    } catch (error) {
        console.error('[CLEAN] Fatal error during cleanup:', error);
    }
})();
