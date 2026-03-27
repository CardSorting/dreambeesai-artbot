import { db, admin, logger } from '../firebase.js';

/**
 * Fetches the Discord-specific user profile.
 * Points to the dedicated 'discord_users' collection.
 * 
 * @param {string} discordId
 */
export async function getUserByDiscordId(discordId) {
    try {
        const doc = await db.collection('discord_users').doc(discordId).get();
        if (!doc.exists) return null;
        return { uid: doc.id, ...doc.data() };
    } catch (err) {
        logger.error(`Failed to fetch user by Discord ID: ${discordId}`, err);
        return null;
    }
}

/**
 * Fetches or creates a Discord-specific user profile.
 * Provisioning initial Zaps for new users to enable immediate creation.
 * 
 * Handles identity synchronization for existing users (tags and avatars).
 * 
 * @param {string} discordId 
 * @param {string} discordTag 
 * @param {string} photoURL
 * @returns {Promise<Object>} The user profile.
 */
export async function getOrCreateDiscordUser(discordId, discordTag, photoURL) {
    const userRef = db.collection('discord_users').doc(discordId);
    
    try {
        const snap = await userRef.get();
        if (snap.exists) {
            const data = snap.data();
            const updates = { lastActive: admin.firestore.FieldValue.serverTimestamp() };
            let hasChanged = false;

            // Identity Sync: Keep local DB in sync with current Discord profile
            if (discordTag && data.discordTag !== discordTag) {
                updates.discordTag = discordTag;
                hasChanged = true;
            }
            if (photoURL && data.photoURL !== photoURL) {
                updates.photoURL = photoURL;
                hasChanged = true;
            }

            if (hasChanged) {
                await userRef.update(updates);
                return { uid: discordId, ...data, ...updates };
            }

            await userRef.update({ lastActive: updates.lastActive }).catch(() => {});
            return { uid: discordId, ...data };
        }

        const newUser = {
            discordId,
            discordTag,
            photoURL: photoURL || null,
            zaps: 100, // Initial Credit Provisioning
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActive: admin.firestore.FieldValue.serverTimestamp(),
            _type: 'discord_native'
        };

        await userRef.set(newUser);
        logger.info(`[Database] Provisioned new Discord user: ${discordTag} (${discordId})`);
        return { uid: discordId, ...newUser };
    } catch (err) {
        logger.error(`Failed in getOrCreateDiscordUser for ${discordId}`, err);
        throw err;
    }
}
