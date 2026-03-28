import fetch from 'node-fetch';
import HttpAgent from 'agentkeepalive';
import pLimit from 'p-limit';
import { db, admin, logger } from '../firebase.js';
import { modalClient } from './modal.js';
import { processAndUploadSingleImage } from '../image-processor.js';

const limit = pLimit(100); 

// HIGH-THROUGHPUT CONFIG
export const keepAliveAgent = new HttpAgent({
    maxSockets: 300,
    maxFreeSockets: 50,
    timeout: 60000,
    freeSocketTimeout: 30000,
    keepAlive: true
});

/**
 * Shared fetch utility with AbortController timeout and exponential backoff.
 */
export async function fetchWithTimeout(resource, options = {}, timeout = 10000) {
    const { signal, maxRetries = 3, ...fetchOptions } = options;
    let attempt = 0;

    const executeRequest = async () => {
        const controller = new AbortController();
        const timerId = setTimeout(() => controller.abort(), timeout);

        if (signal) {
            signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        try {
            const response = await fetch(resource, {
                ...fetchOptions,
                signal: controller.signal
            });
            clearTimeout(timerId);
            
            // Handle 5xx errors with retry logic
            if (response.status >= 500 && attempt < maxRetries) {
                throw new Error(`Server Error: ${response.status}`);
            }

            return response;
        } catch (error) {
            clearTimeout(timerId);
            if (error.name === 'AbortError' && !signal?.aborted && attempt < maxRetries) {
                throw error; // Let retry handle it
            }
            if (attempt >= maxRetries) throw error;
            throw error;
        }
    };

    while (attempt <= maxRetries) {
        try {
            return await executeRequest();
        } catch (err) {
            attempt++;
            if (attempt > maxRetries || (signal && signal.aborted)) throw err;
            
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            logger.warn(`Fetch failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(delay)}ms...`, { resource });
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// Backend API Config
const DREAMBEES_API_URL = process.env.DREAMBEES_API_URL || 'https://dreambeesai.com/api';
const DREAMBEES_API_KEY = process.env.DREAMBEES_API_KEY;

// Circuit Breaker State (Monitoring the Cloud Function API health)
let globalFailureCount = 0;
let lastFailureTimestamp = 0;
const BREAKER_THRESHOLD = 8;
const BREAKER_COOLDOWN_MS = 30000;

function handleFailure(error) {
    globalFailureCount++;
    lastFailureTimestamp = Date.now();
    if (globalFailureCount === BREAKER_THRESHOLD) {
        logger.error(`CIRCUIT BREAKER: Threshold reached. TRIP! Transitions to OPEN status.`, { error: error?.message });
    } else {
        logger.warn(`API Failure recorded. Count: ${globalFailureCount}/${BREAKER_THRESHOLD}`, { error: error?.message });
    }
}

function resetFailures() {
    if (globalFailureCount > 0) {
        if (globalFailureCount >= BREAKER_THRESHOLD) {
            logger.info(`CIRCUIT BREAKER: API appears healthy again. Resetting failure count.`);
        }
        globalFailureCount = 0;
    }
}

export function isCircuitOpen() {
    if (globalFailureCount >= BREAKER_THRESHOLD) {
        const timeSinceLastFailure = Date.now() - lastFailureTimestamp;
        if (timeSinceLastFailure < BREAKER_COOLDOWN_MS) return true;
        
        // Half-open transition could be handled here if needed
        logger.info(`CIRCUIT BREAKER: Cooldown period ended. Attempting trial request.`);
        globalFailureCount = 0; 
    }
    return false;
}

const globalApiLimit = pLimit(process.env.GLOBAL_API_CONCURRENCY || 50);

export async function generateSingleImage(prompt, modelId, userId, options = {}) {
    const { signal, displayName = null, photoURL = null, retries = 3 } = options;
    
    return globalApiLimit(async () => {
        const requestId = options.requestId || `bot_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        try {
            logger.info(`[ModalDirect] Starting generation`, { requestId, userId, modelId });

            // 2. Submit to Modal
            const { endpoint, jobId } = await modalClient.submitJob(modelId || "wai-illustrious", {
                prompt,
                width: 1024,
                height: 1024,
                steps: 30
            });

            // 3. Poll for Buffer
            const buffer = await modalClient.pollResult(endpoint, jobId, { signal });

            if (!buffer) throw new Error("Modal returned empty image buffer.");

            // 4. Process, Watermark, and Upload to B2
            const processingResult = await processAndUploadSingleImage(buffer, userId, {
                prompt,
                modelId: modelId || "wai-illustrious",
                requestId,
                aspectRatio: "1:1",
                steps: 30,
                shouldBookmark: true // Default for bot generations
            });

            resetFailures();
            logger.info(`[ModalDirect] Job completed`, { requestId, imageId: processingResult.imageId });

            // 6. Return standard format (Fetch original buffer for current UX consistency if needed)
            // Actually, we already have the processed buffer if we wanted it, but the bot expects to return it
            return { 
                buffer, // The bot uses the raw buffer for immediate grid/reply if needed
                url: processingResult.imageUrl, 
                imageId: processingResult.imageId 
            };

        } catch (err) {
            logger.error(`[ModalDirect] Generation attempt failed`, { requestId, error: err.message });

            if (retries > 0 && !signal?.aborted) {
                const delay = Math.pow(2, 4 - retries) * 1000 + (Math.random() * 1000);
                logger.info(`[ModalDirect] Retrying in ${Math.round(delay)}ms... (${retries} left)`);
                await new Promise(r => setTimeout(r, delay));
                return generateSingleImage(prompt, modelId, userId, { ...options, retries: retries - 1 });
            }

            // Only trip the circuit breaker if all retries have been exhausted
            handleFailure(err);
            throw err;
        }
    });
}

/**
 * Registers a completed Discord grid with the Backend.
 */
export async function registerDiscordGrid(gridUrl, prompt, modelId, userId, options = {}) {
    const { signal, displayName = null, photoURL = null, requestId } = options;
    return limit(async () => {
        const controller = new AbortController();
        // HARDENING: Increase timeout to 60s for grid registration
        const timeout = setTimeout(() => controller.abort(), 60000);
        
        const onAbortGrid = () => {
            clearTimeout(timeout);
            controller.abort();
        };

        if (signal) {
            if (signal.aborted) {
                onAbortGrid();
            } else {
                signal.addEventListener('abort', onAbortGrid, { once: true });
            }
        }

        try {
            const registerResponse = await fetch(DREAMBEES_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": DREAMBEES_API_KEY,
                    "X-Request-ID": requestId || `bot_grid_${Date.now()}`
                },
                body: JSON.stringify({
                    data: {
                        action: "registerDiscordGrid",
                        gridUrl,
                        prompt,
                        modelId,
                        targetUserId: userId,
                        targetDisplayName: displayName,
                        targetPhotoURL: photoURL,
                        requestId: requestId || `discord_${Date.now()}`
                    }
                }),
                agent: keepAliveAgent,
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (registerResponse.ok) {
                const regResult = await registerResponse.json();
                logger.info(`Grid registered with backend: ${regResult.result?.imageId}`);
                return regResult;
            } else {
                const regErr = await registerResponse.text();
                logger.error(`Failed to register grid with backend`, { status: registerResponse.status, error: regErr });
            }
        } catch (regError) {
            clearTimeout(timeout);
            if (regError.name === 'AbortError') return;
            logger.error(`Error calling registerDiscordGrid`, regError);
        } finally {
            if (signal) signal.removeEventListener('abort', onAbortGrid);
            clearTimeout(timeout);
        }
    });
}
