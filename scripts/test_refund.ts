import fetch from 'node-fetch';
import 'dotenv/config';

async function testRefund() {
    const port = process.env.PORT || 8080;
    const url = `http://localhost:${port}/tasks/process-generation`;
    const interactionId = 'refund_test_' + Date.now();
    
    console.log(`--- 🧪 Hive Refund Diagnostic ---`);
    console.log(`Target: ${url}`);
    console.log(`Testing ID: ${interactionId}`);
    
    // Payload with empty prompt to trigger failure
    const payload = {
        interactionId,
        prompt: '', 
        modelId: 'wai-illustrious',
        discordId: '123456789',
        channelId: '987654321',
        createdAt: Date.now()
    };

    try {
        console.log('\nSending payload that should fail (empty prompt)...');
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        console.log(`Webhook Response: ${res.status} - ${await res.text()}`);
        console.log('\nCheck bot logs for "[WORKER] Autonomous Refund Issued"');

    } catch (err: any) {
        console.error('❌ Connectivity Error:', err.message);
    }
}

testRefund();
