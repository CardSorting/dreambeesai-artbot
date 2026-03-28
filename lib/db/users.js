import { db, admin, logger, COLLECTIONS } from '../firebase.js';

/**
 * Fetches the Discord-specific user profile.
 * Points to the dedicated 'artbot_users' collection.
 * 
 * @param {string} discordId
 */
export async function getUserByDiscordId(discordId) {
    try {
        const doc = await db.collection(COLLECTIONS.USERS).doc(discordId).get();
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
 */
export async function getOrCreateDiscordUser(discordId, discordTag, photoURL) {
    const userRef = db.collection(COLLECTIONS.USERS).doc(discordId);
    
    try {
        return await db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            
            if (snap.exists) {
                const data = snap.data();
                const updates = { lastActive: admin.firestore.FieldValue.serverTimestamp() };
                let hasChanged = false;

                if (discordTag && data.discordTag !== discordTag) {
                    updates.discordTag = discordTag;
                    hasChanged = true;
                }
                if (photoURL && data.photoURL !== photoURL) {
                    updates.photoURL = photoURL;
                    hasChanged = true;
                }

                if (hasChanged) {
                    t.update(userRef, updates);
                    return { uid: discordId, ...data, ...updates };
                }

                t.update(userRef, { lastActive: updates.lastActive });
                return { uid: discordId, ...data };
            }

            const newUser = {
                discordId,
                discordTag,
                photoURL: photoURL || null,
                zaps: 100, 
                joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastActive: admin.firestore.FieldValue.serverTimestamp(),
                _type: 'discord_native'
            };

            t.set(userRef, newUser);
            logger.info(`[Database] Provisioned new Discord user: ${discordTag} (${discordId})`);
            return { uid: discordId, ...newUser };
        });
    } catch (err) {
        logger.error(`Failed in atomic getOrCreateDiscordUser for ${discordId}`, err);
        throw err;
    }
}
