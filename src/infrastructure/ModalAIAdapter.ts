import { GenerationTask, GenerationResult, ModalResponse } from '../domain/Generation.js';
import fetch from 'node-fetch';

/**
 * INFRASTRUCTURE: Adapter for Modal AI Endpoints
 * Purpose: Handle low-level HTTP communication with AI models.
 */
export class ModalAIAdapter {
    private zitEndpoint: string;
    private sdxlEndpoint: string;

    constructor() {
        this.zitEndpoint = process.env.MODAL_ZIT_ENDPOINT || '';
        this.sdxlEndpoint = process.env.MODAL_SDXL_ENDPOINT || '';
    }

    async generate(task: GenerationTask): Promise<GenerationResult> {
        const endpoint = task.modelId.includes('zit') ? this.zitEndpoint : this.sdxlEndpoint;
        
        if (!endpoint) {
            throw new Error(`Endpoint not configured for model: ${task.modelId}`);
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: task.prompt,
                    count: 4,
                    model_id: task.modelId
                })
            });

            if (!response.ok) {
                throw new Error(`AI Model API failed with status ${response.status}`);
            }

            const data = (await response.json()) as ModalResponse;

            if (!data.images || data.images.length === 0) {
                throw new Error('AI Model returned no images');
            }

            return {
                interactionId: task.interactionId,
                images: data.images.map(img => img.content),
                modelId: task.modelId,
                status: 'completed'
            };
        } catch (error: any) {
            return {
                interactionId: task.interactionId,
                images: [],
                modelId: task.modelId,
                status: 'failed',
                error: error.message
            };
        }
    }
}
