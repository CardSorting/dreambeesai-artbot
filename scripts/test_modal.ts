import 'dotenv/config';
import { HiveGenerator } from '../src/services/HiveGenerator.js';

async function testModal() {
    const generator = new HiveGenerator();
    const task = {
        interactionId: 'modal_test_123',
        prompt: 'a beautiful bee',
        modelId: 'sdxl-something',
        discordId: '123',
        channelId: '123',
        createdAt: Date.now()
    };
    
    console.log("Sending payload to Modal...");
    const result = await generator.generate(task);
    console.log("Result:");
    console.log(JSON.stringify(result, null, 2));
}

testModal();
