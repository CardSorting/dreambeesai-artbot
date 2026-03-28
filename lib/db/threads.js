import { db, admin, logger } from '../firebase.js';

/**
 * Retrieves the stored Art Studio thread ID for a user in a specific channel.
 * @param {string} discordId 
 * @param {string} channelId 
 * @returns {Promise<string|null>}
 */
export async function getStudioThreadId(discordId, channelId) {
    try {
        const doc = await db.collection('artbot_studios').doc(`${discordId}_${channelId}`).get();
        return doc.exists ? doc.data().threadId : null;
    } catch (err) {
        logger.error("Failed to fetch studio thread ID", err);
        return null;
    }
}

/**
 * Saves the Art Studio thread ID for a user in a specific channel.
 * @param {string} discordId 
 * @param {string} channelId 
 * @param {string} threadId 
 */
export async function setStudioThreadId(discordId, channelId, threadId) {
    try {
        await db.collection('artbot_studios').doc(`${discordId}_${channelId}`).set({
            discordId,
            channelId,
            threadId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        logger.error("Failed to save studio thread ID", err);
    }
}
