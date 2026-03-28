/**
 * Queen's Guard: Safety Normalization Utilities
 * Handles de-obfuscation and canonical mapping of user input for safety filtering.
 */

import { 
    HIGH_RISK_TERMS, 
    MEDIUM_RISK_TERMS, 
    SAFETY_BLOCKLIST, 
    normalizeForSafety, 
    executeQueenGuardScan 
} from './safety-blocklist.js';

export { HIGH_RISK_TERMS, MEDIUM_RISK_TERMS, SAFETY_BLOCKLIST, normalizeForSafety, executeQueenGuardScan };

// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD]/gu;

/**
 * Escapes characters that could be used for prompt injection or delimiter breakout.
 * Wraps user input in safety tags.
 */
export function wrapInAegis(text) {
    if (!text) return '';
    // Strip common AI control tags, hidden characters, and normalized confusables to prevent breakout
    const stripped = text
        .normalize('NFKC') // De-obfuscate confusables early
        .replace(INVISIBLE_CHARS, '')
        .replace(/<\/user_input>|<user_input>|ignore previous instructions|skip safety|dan:|jailbreak|override context|system prompt|new rule:|assistant:/gi, '[REDACTED]');
    return `<user_input>${stripped}</user_input>`;
}

/**
 * Performs a deep scan of the text across all normalized forms.
 * @deprecated Use executeQueenGuardScan from safety-blocklist instead.
 */
export async function deepGuard(text, blocklist, filterLibrary) {
    if (!text) return true;
    const result = await executeQueenGuardScan(text, filterLibrary);
    return result.approved;
}
