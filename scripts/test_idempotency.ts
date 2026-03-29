import fetch from 'node-fetch';
import 'dotenv/config';

async function testIdempotency() {
    const port = process.env.PORT || 8080;
    const url = `http://localhost:${port}/tasks/process-generation`;
    const interactionId = 'idempotency_test_' + Date.now();
    
    console.log(`--- 🧪 Hive Idempotency Diagnostic ---`);
    console.log(`Target: ${url}`);
    console.log(`Testing ID: ${interactionId}`);
    
    const payload = {
        interactionId,
        prompt: 'a robot bee ensuring idempotency in the hive',
        modelId: 'wai-illustrious',
        discordId: '123456789',
        channelId: '987654321',
        createdAt: Date.now()
    };

    try {
        console.log('\n[Call 1] Sending initial payload...');
        const res1 = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`Status 1: ${res1.status} - ${await res1.text()}`);

        console.log('\n[Call 2] Sending duplicate payload...');
        const res2 = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const body2 = await res2.text();
        console.log(`Status 2: ${res2.status} - ${body2}`);

        if (body2.includes('already_processing_or_completed')) {
            console.log('\n✅ Result: Idempotency Intercept confirmed!');
        } else {
            console.log('\n❌ Result: Idempotency failed. The second call was not intercepted correctly.');
        }

    } catch (err: any) {
        console.error('❌ Connectivity Error:', err.message);
    }
}

testIdempotency();
