import { CONFIG } from './config-check.js';

/**
 * Centralized Model Registry for DreamBees Bot.
 * Defines pricing, descriptions, and backend IDs.
 */
export const MODELS = Object.freeze({
    'wai-illustrious': Object.freeze({
        id: 'wai-illustrious',
        name: 'Dream HQ',
        costPerImage: CONFIG.COSTS.DREAM / 4,
        description: 'High-quality artistic generations.',
        commandDescription: 'Generate a high-quality masterpiece'
    }),
    'zit-h100-v1': Object.freeze({
        id: 'zit-h100-v1',
        name: 'Dream Flash',
        costPerImage: CONFIG.COSTS.FLASH / 4,
        description: 'Near-instant generation for quick ideas.',
        commandDescription: 'Generate an image instantly'
    })
});

/**
 * Calculates the total cost for a batch generation.
 * @param {string} modelId
 * @param {number} count
 * @returns {number}
 */
export function calculateBatchCost(modelId, count = 4) {
    const rawCount = parseInt(count);
    const safeCount = (isNaN(rawCount) || rawCount < 0) ? 0 : Math.min(rawCount, 4); // Cap at 4 for safety
    
    const model = MODELS[modelId] || MODELS['wai-illustrious'];
    const costPerImage = Number(model.costPerImage) || 0;
    
    const totalCost = costPerImage * safeCount;
    return isFinite(totalCost) ? Math.max(0, totalCost) : 0;
}
