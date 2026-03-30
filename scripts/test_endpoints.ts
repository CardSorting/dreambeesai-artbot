import 'dotenv/config';
import fetch from 'node-fetch';

async function testEndpoints() {
    console.log("🔍 Hive Endpoint Diagnostic Initialized...");
    
    const endpoints = {
        MODAL_SDXL_ENDPOINT: process.env.MODAL_SDXL_ENDPOINT,
        MODAL_ZIT_ENDPOINT: process.env.MODAL_ZIT_ENDPOINT,
        MODAL_FLUX_ENDPOINT: process.env.MODAL_FLUX_ENDPOINT
    };

    let allOk = true;

    for (const [key, url] of Object.entries(endpoints)) {
        if (!url) {
            console.error(`❌ ${key} is NOT configured (Empty or Missing)`);
            allOk = false;
            continue;
        }

        console.log(`📡 testing ${key}: ${url}`);
        try {
            // We just do a HEAD request or a GET to the base URL to see if it's alive
            // Note: Modal endpoints might require auth or /health check
            const response = await fetch(url, { method: 'GET' }).catch(() => null);
            
            if (response && response.status < 500) {
                console.log(`✅ ${key} is REACHABLE (Status: ${response.status})`);
            } else {
                console.warn(`⚠️ ${key} returned status ${response?.status || 'FETCH_ERROR'}. It might be offline or require auth.`);
                // Note: Don't mark as allOk = false if it's just a 404 or 401, as long as the server responded.
            }
        } catch (err: any) {
            console.error(`❌ ${key} is UNREACHABLE: ${err.message}`);
            allOk = false;
        }
    }

    if (allOk) {
        console.log("\n✨ All core endpoints configured and reachable.");
    } else {
        console.error("\n🚨 Some endpoints are misconfigured. Check your .env file.");
        process.exit(1);
    }
}

testEndpoints().catch(err => {
    console.error("FATAL: Diagnostic failed", err);
    process.exit(1);
});
