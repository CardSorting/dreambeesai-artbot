import fetch from 'node-fetch';
import HttpAgent from 'agentkeepalive';
import pLimit from 'p-limit';
import { db, logger } from '../db.js';

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
 * Shared fetch utility with AbortController timeout.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { 
            ...options, 
            signal: controller.signal, 
            agent: options.agent || keepAliveAgent 
        });
        return response;
    } finally {
        clearTimeout(timeout);
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

function handleFailure() {
    globalFailureCount++;
    lastFailureTimestamp = Date.now();
    if (globalFailureCount === BREAKER_THRESHOLD) {
        logger.error(`CIRCUIT BREAKER: Threshold reached. TRIP! Transitions to OPEN status.`);
    } else {
        logger.warn(`API Failure recorded. Count: ${globalFailureCount}/${BREAKER_THRESHOLD}`);
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

/**
 * Submits a generation request to the Dreambees Backend API.
 * @param {string} prompt - The sanitized user prompt.
 * @param {string} modelId - The model to use.
 * @param {string} userId - The target identity (DreamBees UUID or Discord Shadow ID `discord:ID`).
 * @param {string} displayName - Optional friendly name for shadow profiles.
 * @param {string} photoURL - Optional avatar URL for shadow profiles.
 * @param {number} retries - Number of retry attempts.
 * @returns {Promise<{buffer: Buffer, url: string, imageId: string}>}
 */
export async function generateSingleImage(prompt, modelId, userId, displayName = null, photoURL = null, retries = 3) {
    return limit(async () => {
        if (!DREAMBEES_API_KEY) {
            throw new Error("DREAMBEES_API_KEY is not configured in environment variables.");
        }

        // THUNDERING HERD PREVENTION: Stagger the start of each batch component
        await new Promise(r => setTimeout(r, Math.random() * 1000));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000); // 45s timeout for submission

        try {
            const submitResponse = await fetch(DREAMBEES_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": DREAMBEES_API_KEY
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
            logger.info(`Listening for completion on ${requestId}...`, { requestId });
            const queueRef = db.collection('generation_queue').doc(requestId);
            
            const generationResult = await new Promise((resolve, reject) => {
                let unsubscribe;
                const pollTimeout = setTimeout(() => {
                    if (unsubscribe) unsubscribe();
                    reject(new Error("Generation timed out in Firestore listener."));
                }, 120000); // 2 minute hard timeout

                unsubscribe = queueRef.onSnapshot(async (snapshot) => {
                    const data = snapshot.data();
                    if (!data) return;

                    if (data.status === 'completed' && data.imageUrl) {
                        clearTimeout(pollTimeout);
                        if (unsubscribe) unsubscribe();
                        resetFailures();
                        resolve({ imageUrl: data.imageUrl, imageId: data.resultImageId });
                    } else if (data.status === 'failed') {
                        clearTimeout(pollTimeout);
                        if (unsubscribe) unsubscribe();
                        handleFailure();
                        reject(new Error(`Generation failed in Backend: ${data.error || 'Unknown worker error'}`));
                    }
                }, (err) => {
                    clearTimeout(pollTimeout);
                    if (unsubscribe) unsubscribe();
                    reject(err);
                });
            });

            // 3. Fetch image from B2 with standard utility
            const imgRes = await fetchWithTimeout(generationResult.imageUrl, { agent: keepAliveAgent }, 30000);
            
            if (!imgRes.ok) throw new Error(`Failed to fetch final image from B2: ${imgRes.status}`);
            
            return { 
                buffer: Buffer.from(await imgRes.arrayBuffer()), 
                url: generationResult.imageUrl, 
                imageId: generationResult.imageId 
            };

        } catch (err) {
            clearTimeout(timeout);
            handleFailure();
            if (err.name === 'AbortError') {
                logger.error(`API Request timed out`, { userId, modelId });
            }
            if (retries > 0) {
                logger.info(`Retrying generation... (${retries} attempts left)`);
                return generateSingleImage(prompt, modelId, userId, displayName, photoURL, retries - 1);
            }
            throw err;
        }
    });
}

/**
 * Registers a completed Discord grid with the Backend.
 * @param {string} gridUrl - The URL of the stitched grid image.
 * @param {string} prompt - The original prompt.
 * @param {string} modelId - The model used.
 * @param {string} userId - The target identity (DreamBees UUID or Discord Shadow ID `discord:ID`).
 * @param {string} displayName - Optional friendly name for shadow profiles.
 * @param {string} photoURL - Optional avatar URL for shadow profiles.
 * @param {string} requestId - The interaction/request ID.
 */
export async function registerDiscordGrid(gridUrl, prompt, modelId, userId, displayName = null, photoURL = null, requestId) {
    return limit(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const registerResponse = await fetch(DREAMBEES_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": DREAMBEES_API_KEY
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
                        requestId: `discord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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
            logger.error(`Error calling registerDiscordGrid`, regError);
        }
    });
}
