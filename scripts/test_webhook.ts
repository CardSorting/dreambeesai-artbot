import fetch from 'node-fetch';
import 'dotenv/config';

async function testWebhook() {
    const port = process.env.PORT || 8080;
    const url = `http://localhost:${port}/tasks/process-generation`;
    
    console.log(`--- 🧪 Hive Webhook Diagnostic ---`);
    console.log(`Target: ${url}`);
    
    const payload = {
        interactionId: 'test_diag_' + Date.now(),
        prompt: 'a cosmic bee harvesting nebula nectar',
        modelId: 'wai-illustrious',
        discordId: '123456789',
        channelId: '987654321',
        createdAt: Date.now()
    };

    try {
        console.log('Sending test payload without OIDC token...');
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log(`Body: ${text}`);

        if (response.status === 401 || response.status === 403) {
            console.log('\n❌ Result: Authentication block confirmed (Expected behavior for production-ready code).');
            console.log('💡 Note: This is why your local tasks are failing to execute without a tunnel + OIDC bypass.');
        } else if (response.status === 200) {
            console.log('\n✅ Result: Webhook accepted the task!');
        } else {
            console.log('\n⚠️ Result: Unexpected status code.');
        }

    } catch (err: any) {
        console.error('❌ Connectivity Error:', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.log('💡 Note: The bot is either not running or listening on a different port.');
        }
    }
}

testWebhook();
