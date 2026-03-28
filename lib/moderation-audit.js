import { db, admin } from './db.js';
import { logger } from './logger.js';

/**
 * Hive Aegis: Moderation Audit System
 * Centralized logging for safety filter rejections and abuse tracking.
 */

export const AuditEvent = {
    PROMPT_REJECTED: 'PROMPT_REJECTED',
    ADMIN_OVERRIDE: 'ADMIN_OVERRIDE',
    ABUSE_STRIKE: 'ABUSE_STRIKE'
};

/**
 * Logs a moderation event to Firestore for deep auditing.
 */
export async function logModerationEvent(data) {
    const { 
        userId, 
        userTag, 
        guildId, 
        originalPrompt, 
        normalizedForms, 
        matchedTerm, 
        action = AuditEvent.PROMPT_REJECTED 
    } = data;

    try {
        const userRef = db.collection('discord_users').doc(userId);
        const userSnap = await userRef.get();
        const userData = userSnap.data() || {};
        
        let strikeWeight = 1;
        const now = Date.now();
        const lastStrike = userData.lastStrikeAt?.toMillis() || 0;

        // Velocity Check: If last strike was within 60 seconds, double the weight
        if (now - lastStrike < 60000) {
            strikeWeight = 2;
            logger.info(`Velocity Match! Escalating strike weight for ${userId}`);
        }

        const docRef = db.collection('moderation_logs').doc();
        await docRef.set({
            eventId: docRef.id,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId,
            userTag,
            guildId,
            originalPrompt,
            normalizedForms,
            matchedTerm,
            strikeWeight,
            action
        });

        // Update user state with velocity-aware strikes
        await userRef.set({
            abuseStrikes: admin.firestore.FieldValue.increment(strikeWeight),
            lastStrikeAt: admin.firestore.FieldValue.serverTimestamp(),
            discordTag: userTag || userData.discordTag
        }, { merge: true });

    } catch (err) {
        logger.error(`Moderation Audit Failed`, { userId, err });
    }
}

/**
 * Checks if a user is currently under a "hive-cool-down" due to excessive rejections.
 */
export async function getAbuseBackoff(userId) {
    try {
        const userDoc = await db.collection('discord_users').doc(userId).get();
        if (!userDoc.exists) return 0;

        const data = userDoc.data();
        const strikes = data.abuseStrikes || 0;
        const lastStrikeAt = data.lastStrikeAt?.toMillis?.() || data.lastStrikeAt?.getTime?.() || 0;
        
        if (strikes < 3 || !lastStrikeAt) return 0;

        // Determine cooldown duration based on strike count
        let cooldownMs = 0;
        if (strikes >= 10) cooldownMs = 7200000;  // 2 hours
        else if (strikes >= 5) cooldownMs = 1800000;  // 30 min
        else if (strikes >= 3) cooldownMs = 300000;   // 5 min

        // Calculate REMAINING cooldown (time since last strike vs cooldown duration)
        const elapsed = Date.now() - lastStrikeAt;
        const remaining = cooldownMs - elapsed;

        return remaining > 0 ? remaining : 0;
    } catch (err) {
        return 0;
    }
}
