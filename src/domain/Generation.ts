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
