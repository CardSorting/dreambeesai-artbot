import dotenv from 'dotenv';
dotenv.config();

const REQUIRED_VARS = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DREAMBEES_API_URL',
    'DREAMBEES_API_KEY',
    'WEBAPP_URL',
    'B2_ENDPOINT',
    'B2_REGION',
    'B2_BUCKET',
    'B2_KEY_ID',
    'B2_APP_KEY',
    'B2_PUBLIC_URL'
];

console.log("Checking environment variables...");
let missing = false;

REQUIRED_VARS.forEach(v => {
    if (!process.env[v]) {
        console.error(`[MISSING] ${v}`);
        missing = true;
    } else {
        console.log(`[OK] ${v}`);
    }
});

if (missing) {
    console.error("\nSome required environment variables are missing. Please check your .env file.");
    process.exit(1);
} else {
    console.log("\nAll required environment variables are present.");
}
