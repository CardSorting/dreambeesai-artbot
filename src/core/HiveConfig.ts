import 'dotenv/config';

/**
 * MISSION CONTROL: Centralized Configuration & Environment Validation
 * Ensures that the Hive has all necessary nectar to function before ignition.
 */
export class HiveConfig {
    static get DISCORD_TOKEN(): string { return this.getRequired('DISCORD_TOKEN'); }
    static get DISCORD_CLIENT_ID(): string { return this.getRequired('DISCORD_CLIENT_ID'); }
    
    static get DREAMBEES_API_URL(): string { return this.getRequired('DREAMBEES_API_URL'); }
    static get DREAMBEES_API_KEY(): string { return this.getRequired('DREAMBEES_API_KEY'); }
    static get DREAMBEES_GUILD_ID(): string { return this.getRequired('DREAMBEES_GUILD_ID'); }
    
    static get NODE_ENV(): string { return process.env.NODE_ENV || 'development'; }
    static get IS_PRODUCTION(): boolean { return this.NODE_ENV === 'production'; }
    
    static get PORT(): number { return parseInt(process.env.PORT || '8080', 10); }
    static get INVITE_LINK(): string { return process.env.INVITE_LINK || 'https://discord.com/invite/curMHRAN8y'; }
    
    static get WORKER_CONCURRENCY(): number { return parseInt(process.env.WORKER_CONCURRENCY || '2', 10); }
    
    // AI Endpoints
    static get MODAL_SDXL_ENDPOINT(): string { return process.env.MODAL_SDXL_ENDPOINT || ''; }
    static get MODAL_ZIT_ENDPOINT(): string { return process.env.MODAL_ZIT_ENDPOINT || ''; }
    static get MODAL_FLUX_ENDPOINT(): string { return process.env.MODAL_FLUX_ENDPOINT || ''; }
    
    // Firebase fallback configuration
    static get FIREBASE_SERVICE_ACCOUNT_JSON(): string | undefined { return process.env.FIREBASE_SERVICE_ACCOUNT_JSON; }
    static get FIREBASE_API_KEY(): string | undefined { return process.env.FIREBASE_API_KEY; }
    static get FIREBASE_AUTH_EMAIL(): string | undefined { return process.env.FIREBASE_AUTH_EMAIL; }
    static get FIREBASE_AUTH_PASSWORD(): string | undefined { return process.env.FIREBASE_AUTH_PASSWORD; }
    static get FIREBASE_AUTH_DOMAIN(): string | undefined { return process.env.FIREBASE_AUTH_DOMAIN; }

    /**
     * IGNITION: Validate all strictly required variables for the bot to start.
     */
    static validate() {
        const required = [
            'DISCORD_TOKEN',
            'DREAMBEES_API_URL',
            'DREAMBEES_API_KEY',
            'DREAMBEES_GUILD_ID'
        ];
        
        const missing = required.filter(key => !process.env[key]);
        if (missing.length > 0) {
            throw new Error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
        }
    }

    private static getRequired(key: string): string {
        const val = process.env[key];
        if (!val) {
             // We throw here if it's accessed and missing, but validate() should be called early.
             throw new Error(`Environment variable ${key} is required but missing.`);
        }
        return val;
    }
}
