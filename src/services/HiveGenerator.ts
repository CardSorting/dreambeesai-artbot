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

    constructor() {
        this.zitEndpoint = process.env.MODAL_ZIT_ENDPOINT || '';
        this.sdxlEndpoint = process.env.MODAL_SDXL_ENDPOINT || '';
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

    /**
     * STITCH: Combine multiple buffers into a single 2x2 grid.
     * Formerly in ImageProcessor.
     */
    static async stitch(buffers: Buffer[]): Promise<Buffer> {
        if (!buffers || buffers.length === 0) {
            throw new Error('No nectar (buffers) provided for stitching.');
        }

        const metadata = await sharp(buffers[0]).metadata();
        const width = metadata.width || 1024;
        const height = metadata.height || 1024;

        const canvas = sharp({
            create: {
                width: width * 2,
                height: height * 2,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        });

        const composites = buffers.slice(0, 4).map((buf, index) => ({
            input: buf,
            top: index < 2 ? 0 : height,
            left: index % 2 === 0 ? 0 : width,
        }));

        return canvas.composite(composites).webp().toBuffer();
    }
}
