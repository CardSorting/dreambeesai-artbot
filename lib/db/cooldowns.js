import { db, admin } from '../firebase.js';

/**
 * Checks if a user is on cooldown. Returns remaining ms or 0.
 */
export async function getRemainingCooldown(userId) {
    const doc = await db.collection('discord_cooldowns').doc(userId).get();
    if (!doc.exists) return 0;
    const data = doc.data();
    const remaining = data.endsAt.toDate() - new Date();
    return remaining > 0 ? remaining : 0;
}

/**
 * Sets a cooldown for a user.
 */
export async function setCooldown(userId, durationMs) {
    const endsAt = new Date(Date.now() + durationMs);
    await db.collection('discord_cooldowns').doc(userId).set({
        endsAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}
