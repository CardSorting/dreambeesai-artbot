import { calculateBatchCost } from './lib/models.js';

console.log('--- FORTRESS TEST START ---');

// 1. Math Safety Tests
console.log('Test: calculateBatchCost with string count');
const cost1 = calculateBatchCost('wai-illustrious', '4');
console.log(`Result: ${cost1} (Expected: 4)`);

console.log('\nTest: calculateBatchCost with NaN count');
const cost2 = calculateBatchCost('wai-illustrious', NaN);
console.log(`Result: ${cost2} (Expected: 0)`);

console.log('\nTest: calculateBatchCost with negative count');
const cost3 = calculateBatchCost('wai-illustrious', -5);
console.log(`Result: ${cost3} (Expected: 0)`);

console.log('\nTest: calculateBatchCost with invalid modelId');
const cost4 = calculateBatchCost('invalid-model', 4);
console.log(`Result: ${cost4} (Expected: 4 - defaults to HQ)`);

// 2. Webhook Validation Internal Test (Dry Run)
function validateTaskPayload(payload) {
    const required = ['requestId', 'prompt', 'modelId', 'userId', 'discordId'];
    const missing = required.filter(field => !payload[field]);
    if (missing.length > 0) return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
    if (typeof payload.requestId !== 'string') return { valid: false, error: 'requestId must be a string' };
    if (typeof payload.prompt !== 'string' || payload.prompt.length < 3) return { valid: false, error: 'prompt too short or invalid' };
    return { valid: true };
}

console.log('\nTest: validateTaskPayload with missing field');
const v1 = validateTaskPayload({ requestId: '123', prompt: 'hello' });
console.log(`Result: ${v1.valid} - ${v1.error}`);

console.log('\nTest: validateTaskPayload with short prompt');
const v2 = validateTaskPayload({ requestId: '123', prompt: 'a', modelId: 'm', userId: 'u', discordId: 'd' });
console.log(`Result: ${v2.valid} - ${v2.error}`);

console.log('\nTest: validateTaskPayload with valid payload');
const v3 = validateTaskPayload({ requestId: '123', prompt: 'a beautiful sunset', modelId: 'm', userId: 'u', discordId: 'd' });
console.log(`Result: ${v3.valid}`);

console.log('\n--- FORTRESS TEST COMPLETE ---');
