import { CONFIG } from './config-check.js';

/**
 * Centralized Model Registry for DreamBees Bot.
 * Defines pricing, descriptions, and backend IDs.
 */
export const MODELS = {
    'wai-illustrious': { // Standard HQ
        id: 'wai-illustrious',
        name: 'Dream HQ',
        costPerImage: CONFIG.COSTS.DREAM / 4,
        description: 'High-quality artistic generations.',
        commandDescription: 'Generate a high-quality masterpiece'
    },
    'zit-h100-v1': { // Fast/Flash
        id: 'zit-h100-v1',
        name: 'Dream Flash',
        costPerImage: CONFIG.COSTS.FLASH / 4,
        description: 'Near-instant generation for quick ideas.',
        commandDescription: 'Generate an image instantly'
    }
};

/**
 * Calculates the total cost for a batch generation.
 * @param {string} modelId
 * @param {number} count
 * @returns {number}
 */
export function calculateBatchCost(modelId, count = 4) {
    const model = MODELS[modelId] || MODELS['wai-illustrious'];
    return model.costPerImage * count;
}
