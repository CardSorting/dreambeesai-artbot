import fetch from 'node-fetch';
import sharp from 'sharp';

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
    private zitEndpoint: string;
    private sdxlEndpoint: string;
    private fluxEndpoint: string;

    constructor() {
        this.zitEndpoint = process.env.MODAL_ZIT_ENDPOINT || '';
        this.sdxlEndpoint = process.env.MODAL_SDXL_ENDPOINT || '';
        this.fluxEndpoint = process.env.MODAL_FLUX_ENDPOINT || '';
    }

    /**
     * GENERATE: High-level entry point for AI model interaction.
     * Formerly in ModalAIAdapter.
     */
    async generate(task: GenerationTask): Promise<GenerationResult> {
        const endpoint = task.modelId.includes('zit') ? this.zitEndpoint : this.sdxlEndpoint;

        if (!endpoint) {
            throw new Error(`Endpoint not configured for model: ${task.modelId}`);
        }

        try {
            const response = await fetch(`${endpoint}/generate`, {
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
        while (attempts < 60) { // Max 2 mins wait
            await new Promise(r => setTimeout(r, 2000));

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
