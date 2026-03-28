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
    'B2_PUBLIC_URL',
    'FIREBASE_PROJECT_ID',
];

console.log("Checking environment variables...");
let missing = false;

REQUIRED_VARS.forEach(v => {
    if (!process.env[v]) {
        if (v === 'FIREBASE_PROJECT_ID' && process.env.GCLOUD_PROJECT) {
            console.log(`[OK] FIREBASE_PROJECT_ID (Using GCLOUD_PROJECT fallback)`);
            return;
        }
        console.error(`[MISSING] ${v}`);
        missing = true;
    } else {
        console.log(`[OK] ${v}`);
    }
});

// Additional File Checks
import fs from 'fs';
import path from 'path';

console.log("\nChecking critical files...");
const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(process.cwd(), './serviceAccountKey.json');
const hasSA = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || fs.existsSync(saPath);
const hasWebSDK = process.env.FIREBASE_API_KEY;

if (!hasSA && !hasWebSDK) {
    console.error(`[MISSING] Firebase Credentials! Neither a Service Account nor a Web SDK API Key was found.`);
    missing = true;
} else if (hasSA) {
    console.log(`[OK] Firebase Service Account credentials found (Admin SDK mode).`);
} else {
    console.log(`[OK] Firebase API Key found (Web SDK Fallback mode).`);
}

if (missing) {
    console.error("\n❌ Hardening Failed: Some required configuration elements are missing.");
    process.exit(1);
} else {
    console.log("\n✅ Configuration Hardening Passed: All required elements are present.");
}
