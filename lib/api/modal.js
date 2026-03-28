import fetch from 'node-fetch';
import { logger } from '../logger.js';

export const MODAL_ENDPOINTS = {
    'zit_h100': process.env.MODAL_ZIT_ENDPOINT,
    'sdxl_h100': process.env.MODAL_SDXL_ENDPOINT,
    'flux_klein': process.env.MODAL_FLUX_ENDPOINT,
};

/**
 * Handles communication with Modal endpoints.
 */
export class ModalClient {
    /**
     * Submits a generation job to Modal.
     */
    async submitJob(modelId, payload, options = {}) {
        const { signal, timeout = 30000 } = options;
        const endpoint = this.getEndpoint(modelId);
        const url = `${endpoint}/generate`;

        logger.info(`[Modal] Submitting ${modelId} job to ${url}`);

        // CRITICAL FIX: Add hard timeout to prevent indefinite hangs
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            logger.error(`[Modal] Submission timeout after ${timeout}ms for ${modelId}`);
        }, timeout);

        // Link external signal if provided
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                controller.abort();
            }, { once: true });
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!response.ok) {
                const errText = await response.text();
                // CATEGORY-AWARE ERROR WRAPPING: Distinguish between transient and terminal failures
                const status = response.status;
                let isTransient = (status >= 500 || status === 429 || status === 408);
                const error = new Error(`Modal submission failed (${status}): ${errText}`);
                error.isTransient = isTransient;
                error.status = status;
                throw error;
            }

            const { job_id } = await response.json();
            if (!job_id) throw new Error("Modal did not return a job_id.");

            logger.info(`[Modal] Job submitted successfully. ID: ${job_id}`);
            return { endpoint, jobId: job_id };
        } catch (error) {
            logger.error(`[Modal] Submission Error`, error);
            throw error;
        }
    }

    /**
     * Polls for the result of a submitted job.
     */
    async pollResult(endpoint, jobId, options = {}) {
        const { maxRetries = 60, delay = 3000, signal } = options;
        const url = `${endpoint}/result/${jobId}`;

        logger.info(`[Modal] Starting poll for job ${jobId}`);

        for (let i = 0; i < maxRetries; i++) {
            if (signal?.aborted) {
                logger.warn(`[Modal] Polling for job ${jobId} aborted by signal.`);
                throw new Error("Polling aborted.");
            }
            try {
                const response = await fetch(url, { signal });

                if (response.status === 200) {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('image/')) {
                        logger.info(`[Modal] Job ${jobId} completed successfully.`);
                        return Buffer.from(await response.arrayBuffer());
                    }

                    const data = await response.json().catch(() => ({}));
                    if (data.status === 'failed') {
                        throw new Error(`Modal Job Failed: ${data.error || 'Unknown error'}`);
                    }
                } else if (response.status === 202) {
                    // Still processing
                    if (i % 5 === 0) logger.info(`[Modal] Job ${jobId} status: Processing...`);
                } else if (response.status === 404) {
                    // Not found or not started yet
                    if (i % 5 === 0) logger.info(`[Modal] Job ${jobId} status: Queued/Not Found...`);
                } else {
                    const errText = await response.text();
                    logger.error(`[Modal] Polling error for job ${jobId}`, { status: response.status, errText });
                }
            } catch (error) {
                logger.warn(`[Modal] Polling attempt ${i} failed`, { error: error.message });
                if (i === maxRetries - 1) throw error;
            }

            // HIGH PRIORITY FIX: Add jitter to prevent thundering herd
            const jitter = Math.random() * 1000;
            const backoffDelay = Math.min(delay + jitter, 10000); // Cap at 10s
            await new Promise(r => setTimeout(r, backoffDelay));
        }

        throw new Error(`Modal Polling Timed Out for job: ${jobId}`);
    }

    getEndpoint(modelId) {
        if (modelId.includes('zit')) return MODAL_ENDPOINTS.zit_h100;
        if (modelId.includes('flux')) return MODAL_ENDPOINTS.flux_klein;
        // Default to SDXL H100 for everything else
        return MODAL_ENDPOINTS.sdxl_h100;
    }
}

export const modalClient = new ModalClient();
