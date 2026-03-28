import { logger } from './logger.js';

/**
 * Handles Firestore Timestamps, JS Dates, and ISO strings consistently.
 * 
 * @param {any} val - The raw value from Firestore or a plain object.
 * @returns {Date} Normalized JS Date object.
 */
export function normalizeDate(val) {
    if (!val) return new Date(0);
    if (val.toDate && typeof val.toDate === 'function') return val.toDate(); // Firestore Timestamp
    if (val.toMillis && typeof val.toMillis === 'function') return new Date(val.toMillis()); // SDK-specific Timestamp
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(val); // Assume epoch ms
    if (typeof val === 'string') return new Date(val); // Assume ISO string
    
    logger.warn("Unrecognized date format during normalization", { type: typeof val });
    return new Date(0);
}

/**
 * Formats a duration in ms into a human-readable string.
 */
export function formatDuration(ms) {
    if (ms < 1000) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || (h === 0 && m === 0)) parts.push(`${s}s`);
    
    return parts.join(" ");
}
