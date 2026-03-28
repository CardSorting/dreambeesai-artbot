import fetch from 'node-fetch';
import HttpAgent from 'agentkeepalive';
import pLimit from 'p-limit';
import { db, logger } from '../firebase.js';

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

/**
 * Submits a generation request to the Dreambees Backend API.
 * @param {string} prompt - The sanitized user prompt.
 * @param {string} modelId - The model to use.
 * @param {string} userId - The target identity (DreamBees UUID or Discord Shadow ID `discord:ID`).
 * @param {Object} options - Options including signal, displayName, photoURL, and retries.
 * @returns {Promise<{buffer: Buffer, url: string, imageId: string}>}
 */
export async function generateSingleImage(prompt, modelId, userId, options = {}) {
    const { signal, displayName = null, photoURL = null, retries = 3 } = options;
    
    return globalApiLimit(async () => {
        if (!DREAMBEES_API_KEY) {
            throw new Error("DREAMBEES_API_KEY is not configured in environment variables.");
        }

        // STAGGERED START JITTER: Prevent "Thundering Herd" on simultaneous batch starts
        if (!signal?.aborted) {
            await new Promise(r => setTimeout(r, Math.random() * 1000));
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000); 

        const onAbortRaw = () => {
            clearTimeout(timeout);
            controller.abort();
        };

        if (signal) {
            if (signal.aborted) {
                onAbortRaw();
            } else {
                signal.addEventListener('abort', onAbortRaw, { once: true });
            }
        }

        try {
            const submitResponse = await fetch(DREAMBEES_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": DREAMBEES_API_KEY,
                    "X-Request-ID": options.requestId || `bot_${Date.now()}`
                },
                body: JSON.stringify({
                    data: {
                        action: "createGenerationRequest",
                        prompt,
                        modelId: modelId || "wai-illustrious",
                        targetUserId: userId,
                        aspectRatio: "1:1",
                        steps: 30,
                        shouldBookmark: false
                    }
                }),
                agent: keepAliveAgent,
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!submitResponse.ok) {
                handleFailure();
                const errBody = await submitResponse.text();
                throw new Error(`Backend Submission Failed (${submitResponse.status}): ${errBody}`);
            }

            const { result } = await submitResponse.json();
            const requestId = result?.requestId;
            if (!requestId) throw new Error("Backend did not return a requestId.");

            logger.info(`Job queued via Backend`, { requestId, userId });

            // 2. Poll FIRESTORE for the generation status
            const queueRef = db.collection('generation_queue').doc(requestId);
            
            const generationResult = await new Promise((resolve, reject) => {
                let isSettled = false;
                let unsubscribe;

                const settle = (callback, value) => {
                    if (isSettled) return;
                    isSettled = true;
                    clearTimeout(hardTimeout);
                    if (unsubscribe) unsubscribe();
                    callback(value);
                };

                const onAbort = () => settle(reject, new Error("Generation cancelled by signal."));
                if (signal) {
                    if (signal.aborted) return onAbort();
                    signal.addEventListener('abort', onAbort, { once: true });
                }

                unsubscribe = queueRef.onSnapshot(async (snapshot) => {
                    const data = snapshot.data();
                    if (!data) return;

                    if (data.status === 'completed' && data.imageUrl) {
                        resetFailures();
                        settle(resolve, { imageUrl: data.imageUrl, imageId: data.resultImageId });
                    } else if (data.status === 'failed') {
                        handleFailure();
                        settle(reject, new Error(`Generation failed in Backend: ${data.error || 'Unknown worker error'}`));
                    }
                }, (err) => {
                    handleFailure();
                    settle(reject, err);
                });

                // Hard Timeout (2 minutes)
                const hardTimeout = setTimeout(() => {
                    handleFailure();
                    settle(reject, new Error("Generation timed out in Firestore listener."));
                }, 120000);
            });

            // Cleanup signal listener to prevent and assist GC
            if (signal) signal.removeEventListener('abort', onAbortRaw);
            clearTimeout(timeout);

            // 3. Fetch image from B2 with standard utility
            const imgRes = await fetchWithTimeout(generationResult.imageUrl, { agent: keepAliveAgent, signal }, 30000);
            
            if (!imgRes.ok) throw new Error(`Failed to fetch final image from B2: ${imgRes.status}`);
            
            return { 
                buffer: Buffer.from(await imgRes.arrayBuffer()), 
                url: generationResult.imageUrl, 
                imageId: generationResult.imageId 
            };

        } catch (err) {
            clearTimeout(timeout);
            handleFailure(err);
            if (err.name === 'AbortError') {
                logger.error(`API Request timed out or cancelled`, { userId, modelId });
            }
            if (retries > 0 && !signal?.aborted) {
                const delay = Math.pow(2, 4 - retries) * 1000 + (Math.random() * 1000);
                logger.info(`Retrying generation in ${Math.round(delay)}ms... (${retries} attempts left)`);
                await new Promise(r => setTimeout(r, delay));
                return generateSingleImage(prompt, modelId, userId, { signal, displayName, photoURL, retries: retries - 1 });
            }
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
        const timeout = setTimeout(() => controller.abort(), 30000);
        
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
