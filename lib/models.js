/**
 * Centralized Model Registry for DreamBees Bot.
 * Defines pricing, descriptions, and backend IDs.
 */
export const MODELS = {
    'wai-illustrious': { // SDXL H100
        id: 'wai-illustrious',
        name: 'SDXL H100',
        costPerImage: 1,
        description: 'High-performance SDXL generation using H100 GPUs.',
        commandDescription: 'Generate an image using SDXL H100'
    },
    'zit-h100-v1': { // ZIT H100
        id: 'zit-h100-v1',
        name: 'Zit H100',
        costPerImage: 1,
        description: 'Zero-latency Image Transformer (ZIT) on H100 clusters.',
        commandDescription: 'Generate an image using Zit H100'
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
