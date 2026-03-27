/**
 * DreamBees Database Barrel File
 * 
 * This file re-exports all logic from the modular lib/db/ directory.
 * Use this as the primary entry point to maintain backward compatibility.
 */

import { db, admin, logger } from './firebase.js';

// Re-export Core
export { db, admin, logger };

// Re-export Modules
export * from './db/config.js';
export * from './db/users.js';
export * from './db/generations.js';
export * from './db/locks.js';
export * from './db/cooldowns.js';
export * from './db/threads.js';
export * from './db/recovery.js';

/**
 * [DEPRECATED] Creates a secure handshake session.
 * Handshakes are no longer used as Discord accounts are now separate.
 */
export async function createLinkSession(discordId, discordTag, metadata = {}) {
    logger.warn(`Attempted to create link session for ${discordId} - This API is deprecated.`);
    return "deprecated_" + Math.random().toString(36).substring(7);
}

/**
 * [DEPRECATED] Deletes a handshake session.
 */
export async function deleteLinkSession(pairingId) {
    // No-op
}
