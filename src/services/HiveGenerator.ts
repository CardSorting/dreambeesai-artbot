import fetch from 'node-fetch';
import sharp from 'sharp';
import { HiveConfig } from '../core/HiveConfig.js';

/**
 * DOMAIN: Pure Business Models for AI Generation
 * Standardizes the contract between Core and Infrastructure.
 */
export interface GenerationTask {
    interactionId: string;
    prompt: string;
    modelId: string;
    discordId: string;
    channelId: string;
    guildId?: string;
    createdAt: number;
    imageUrl?: string; // Passed when Remix is active
    numSteps?: number; // Configurable for edit intensity
    count?: number; // For vibe grids
}

export interface GenerationResult {
    interactionId: string;
    images: string[]; // Base64 or URLs
    modelId: string;
    stitchedBuffer?: Buffer;
    status: 'completed' | 'failed';
    error?: string;
}

export interface ModalResponse {
    images: Array<{ content: string; seed: number }>;
    status: string;
}

/**
 * MISSION GENERATOR: Consolidated AI Adaption & Image Processing
 * Replaces: ModalAIAdapter, ImageProcessor, and Generation Domain models.
 */
export class HiveGenerator {
    private get zitEndpoint(): string { return HiveConfig.MODAL_ZIT_ENDPOINT; }
    private get sdxlEndpoint(): string { return HiveConfig.MODAL_SDXL_ENDPOINT; }
    private get fluxEndpoint(): string { return HiveConfig.MODAL_FLUX_ENDPOINT; }

    constructor() {}

    /**
     * GENERATE: High-level entry point for AI model interaction.
     * Formerly in ModalAIAdapter.
     */
    async generate(task: GenerationTask): Promise<GenerationResult> {
        let endpoint = '';
        
        // Explicit mapping for known models
        if (task.modelId.includes('zit')) {
            endpoint = this.zitEndpoint;
        } else if (task.modelId === 'wai-illustrious' || task.modelId.includes('sdxl')) {
            endpoint = this.sdxlEndpoint;
        } else if (task.modelId.includes('flux')) {
            endpoint = this.fluxEndpoint;
        } else {
            // Fallback for custom or unrecognized models
            endpoint = this.sdxlEndpoint;
        }

        if (!endpoint) {
            const status = `SDXL=${!!this.sdxlEndpoint}, ZIT=${!!this.zitEndpoint}, FLUX=${!!this.fluxEndpoint}`;
            console.error(`[HiveGenerator] Endpoint configuration missing for model: ${task.modelId} (${status})`);
            throw new Error(`Endpoint not configured for model: ${task.modelId}`);
        }

        try {
            const count = task.count || 4; // Generate 4 images by default unless specified
            const promises = [];

            for (let i = 0; i < count; i++) {
                promises.push(this.submitAndPollGenerate(endpoint, task.prompt, task.modelId, i));
            }

            const results = await Promise.all(promises);

            return {
                interactionId: task.interactionId,
                images: results,
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

    private async submitAndPollGenerate(endpoint: string, prompt: string, model_id: string, seedModifier: number): Promise<string> {
        const submitResponse = await fetch(`${endpoint}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                count: 1, // Let parallel Modal containers handle concurrency
                model_id,
                seed: 42 + seedModifier
            })
        });

        if (!submitResponse.ok) {
            const text = await submitResponse.text().catch(() => '');
            throw new Error(`AI Generate API failed with status ${submitResponse.status}: ${text}`);
        }

        const data = (await submitResponse.json()) as any;
        
        // Backwards compatibility for older sync endpoints
        if (data.images && data.images.length > 0) {
            return data.images[0].content || data.images[0];
        }

        if (!data.job_id) {
            throw new Error('AI Model did not return a job_id');
        }

        const jobId = data.job_id;
        let attempts = 0;
        let delay = 2000;
        
        while (attempts < 60) { // Max ~2-5 mins wait depending on backoff
            await new Promise(r => setTimeout(r, delay));
            
            const pollResponse = await fetch(`${endpoint}/result/${jobId}`);

            if (pollResponse.ok && pollResponse.headers.get('content-type')?.includes('image')) {
                const arrayBuffer = await pollResponse.arrayBuffer();
                return Buffer.from(arrayBuffer).toString('base64');
            }

            if (pollResponse.ok && pollResponse.headers.get('content-type')?.includes('json')) {
                const statusData = await pollResponse.json() as any;
                if (statusData.status === 'failed') {
                    throw new Error(statusData.error || 'Job failed during generation.');
                }
                if (statusData.status === 'completed' && statusData.result) {
                    return Buffer.from(statusData.result, 'hex').toString('base64');
                }
            }
            
            // Exponential backoff
            attempts++;
            delay = Math.min(delay * 1.5, 10000); 
        }

        throw new Error('Generation timed out polling API');
    }

    /**
     * REMIX: Async Polling image-to-image loop targeting FLUX-Klein.
     * Supports concurrent generation (count) by firing up parallel Modal containers.
     */
    async remix(task: GenerationTask, imageUrl: string): Promise<GenerationResult> {
        if (!this.fluxEndpoint) {
            throw new Error('MODAL_FLUX_ENDPOINT missing or not configured');
        }

        const count = task.count || 1;
        const numSteps = task.numSteps || 10;
        const promises = [];

        // Spin up N overlapping requests and track results natively
        for (let i = 0; i < count; i++) {
            promises.push(this.submitAndPollRemix(task.prompt, imageUrl, numSteps, i));
        }

        try {
            const results = await Promise.all(promises);
            return {
                interactionId: task.interactionId,
                images: results,
                modelId: 'flux-klein-4b',
                status: 'completed'
            };
        } catch (error: any) {
            return {
                interactionId: task.interactionId,
                images: [],
                modelId: 'flux-klein-4b',
                status: 'failed',
                error: error.message
            };
        }
    }

    private async submitAndPollRemix(prompt: string, image: string, num_steps: number, seedModifier: number): Promise<string> {
        // 1. Submit Edit Job
        const submitResponse = await fetch(`${this.fluxEndpoint}/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                image,
                num_steps,
                seed: 42 + seedModifier // Mutate seed slightly for grids
            })
        });

        if (!submitResponse.ok) {
            const text = await submitResponse.text().catch(() => '');
            throw new Error(`AI Edit API failed with status ${submitResponse.status}: ${text}`);
        }

        const data = (await submitResponse.json()) as any;
        if (!data.job_id) {
            throw new Error('AI Model did not return a job_id');
        }

        // 2. Polling Loop
        let attempts = 0;
        let delay = 2000;
        while (attempts < 60) { 
            await new Promise(r => setTimeout(r, delay));

            const pollResponse = await fetch(`${this.fluxEndpoint}/result/${data.job_id}`);

            // If it's the image buffer directly (completed)
            if (pollResponse.ok && pollResponse.headers.get('content-type')?.includes('image')) {
                const arrayBuffer = await pollResponse.arrayBuffer();
                return Buffer.from(arrayBuffer).toString('base64');
            }

            // If it's a JSON status message
            if (pollResponse.ok && pollResponse.headers.get('content-type')?.includes('json')) {
                const statusData = await pollResponse.json() as any;
                if (statusData.status === 'failed') {
                    throw new Error(statusData.error || 'Job failed during generation.');
                }
                if (statusData.status === 'completed' && statusData.result) {
                    return Buffer.from(statusData.result, 'hex').toString('base64');
                }
                // 'generating' or 'queued', just continue polling
            }

            attempts++;
            delay = Math.min(delay * 1.5, 10000);
        }

        throw new Error('Generation timed out polling FLUX API');
    }

    private static createWatermarkBuffer(width: number, height: number): Buffer {
        return Buffer.from(`
            <svg width="${width}" height="${height}">
                <style>
                    .watermark { 
                        fill: rgba(255, 255, 255, 0.45); 
                        font-size: ${Math.max(24, Math.floor(height * 0.025))}px; 
                        font-weight: bold; 
                        font-family: Arial, sans-serif; 
                    }
                </style>
                <text x="${width - Math.max(160, Math.floor(width * 0.15))}" y="${height - 20}" class="watermark">DreamBeesai.com</text>
            </svg>
        `);
    }

    /**
     * STITCH: Combine multiple buffers into a single 2x2 grid.
     * Formats output with DreamBees watermark natively.
     */
    static async stitch(buffers: Buffer[]): Promise<Buffer> {
        if (!buffers || buffers.length === 0) {
            throw new Error('No nectar (buffers) provided for stitching.');
        }

        const metadata = await sharp(buffers[0]).metadata();
        const width = metadata.width || 1024;
        const height = metadata.height || 1024;

        // If only 1 buffer, just wrap it alone
        if (buffers.length === 1) {
            return sharp(buffers[0])
                .composite([{ input: this.createWatermarkBuffer(width, height), top: 0, left: 0, blend: 'over' }])
                .webp()
                .toBuffer();
        }

        const canvasWidth = width * 2;
        const canvasHeight = height * 2;

        const canvas = sharp({
            create: {
                width: canvasWidth,
                height: canvasHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        });

        const composites = buffers.slice(0, 4).map((buf, index) => ({
            input: buf,
            top: index < 2 ? 0 : height,
            left: index % 2 === 0 ? 0 : width,
        }));

        composites.push({
            input: this.createWatermarkBuffer(canvasWidth, canvasHeight),
            top: 0,
            left: 0
        });

        return canvas.composite(composites as any).webp().toBuffer();
    }
}
