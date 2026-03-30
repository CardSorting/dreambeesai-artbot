import 'dotenv/config';
import { HiveGenerator } from './src/services/HiveGenerator.js';

async function verify() {
    console.log("🚀 Verifying HiveGenerator fix...");
    const generator = new HiveGenerator();
    
    const tasks = [
        { modelId: 'wai-illustrious', name: 'Illustrious' },
        { modelId: 'zit-h100-v1', name: 'ZIT' },
        { modelId: 'sdxl-v1', name: 'SDXL Pattern' },
        { modelId: 'unknown-model', name: 'Fallback Pattern' }
    ];

    for (const t of tasks) {
        console.log(`\nTesting mapping for: ${t.name} (${t.modelId})`);
        try {
            // We use a private-access trick for verification
            // @ts-ignore
            const endpoint = (generator as any).generate({ modelId: t.modelId, prompt: 'test' }).then(() => {}).catch((err: any) => {
                 // We don't care about the ACTUAL fetch failing here, 
                 // just if it GETS PAST the "Endpoint not configured" check.
                 if (err.message.includes("Endpoint not configured")) {
                     console.error(`❌ FAILED: ${t.modelId} still has no endpoint.`);
                 } else {
                     console.log(`✅ PASSED: ${t.modelId} mapping exists.`);
                     // Further check which endpoint it's trying to use if we could
                 }
            });
        } catch (err: any) {
             console.error(`💥 Unexpected Error: ${err.message}`);
        }
    }
}

verify().catch(console.error);
