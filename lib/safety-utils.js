/**
 * Queen's Guard: Safety Normalization Utilities
 * Handles de-obfuscation and canonical mapping of user input for safety filtering.
 */

const LEET_MAP = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
    '$': 's', '@': 'a', '!': 'i', '|': 'i', '(': 'c', '{': 'c', '[': 'c',
    '#': 'h', '*': 'a', '+': 't', 'v': 'v', 'w': 'w', 'cl': 'd', 'vv': 'w',
    'rn': 'm', 'q': 'g', '\\/': 'v', '|\\/|': 'm', 'l||l': 'm',
    // Unicode Confusables
    '\u03BF': 'o', '\u03C1': 'r', '\u03B1': 'a', '\u03B5': 'e', '\u03B9': 'i', 
    '\u03BA': 'k', '\u03BD': 'v', '\u03C3': 's', '\u03C4': 't', '\u03C9': 'w', 
    '\u03C7': 'x', '\u0430': 'a', '\u0435': 'e', '\u0440': 'p', '\u0441': 'c', 
    '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u0455': 's',
    '\u043E': 'o', '\u1D21': 'v', '\u1D1C': 'u', '\u2133': 'm', '\u210D': 'h'
};

const HIGH_RISK_TERMS = ['nsfw', 'porn', 'sex', 'sexual', 'hentai', 'nude', 'naked'];
const MEDIUM_RISK_TERMS = ['gore', 'violence', 'violent', 'blood', 'bloody', 'killing', 'murder', 'dead', 'death', 'suicide', 'abuse'];

const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD]/g;

/**
 * Escapes characters that could be used for prompt injection or delimiter breakout.
 * Wraps user input in safety tags.
 */
export function wrapInAegis(text) {
    if (!text) return '';
    // Strip common AI control tags and invisible characters to prevent breakout
    const stripped = text
        .replace(INVISIBLE_CHARS, '')
        .replace(/<\/user_input>|<user_input>|ignore previous instructions|skip safety|dan:|jailbreak/gi, '[REDACTED]');
    return `<user_input>${stripped}</user_input>`;
}

/**
 * Normalizes text to a canonical form for safety checks.
 * 1. Unicode Normalization (NFKD)
 * 2. Case folding (lowercase)
 * 3. Multi-character Lookalike Replacement (cl -> d, vv -> w)
 * 4. Standard Leet mapping
 * 5. Punctuation Strip
 */
/**
 * Normalizes text to a canonical form for safety checks.
 * 1. Invisible character stripping
 * 2. Unicode Confusable Resolution (α -> a, а -> a)
 * 3. Multi-character lookalikes (vv -> w, cl -> d)
 * 4. Standard Leet mapping (0 -> o, 1 -> i)
 */
export function normalizeForSafety(text) {
    if (!text) return { original: '', lowercase: '', deobfuscated: '', condensed: '' };

    // 0. Strip invisible characters
    let stripped = text.replace(INVISIBLE_CHARS, '');

    // 1. Case Folding & Unicode Normalization (NFKD)
    let processed = stripped.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, "") 
        .toLowerCase();

    // 2. High-Fidelity Unicode Confusable Resolution (Pass 1)
    // We do this first so multi-char ASCII checks (cl, vv) work on resolved characters.
    let resolved = '';
    for (const char of processed) {
        resolved += LEET_MAP[char] || char;
    }

    // 3. Multi-character Lookalike Replacements (Pass 2)
    const multiLookalikes = { 'vv': 'w', 'cl': 'd', '\\/': 'v', '|\\/|': 'm' };
    let deobfuscated = resolved;
    for (const [key, val] of Object.entries(multiLookalikes)) {
        deobfuscated = deobfuscated.split(key).join(val);
    }

    // 4. Secondary Leet Sweep (Pass 3)
    // Catch anything that might have been formed or missed
    let finalDeobfuscated = '';
    for (const char of deobfuscated) {
        finalDeobfuscated += LEET_MAP[char] || char;
    }

    // 5. Build condensed version (no spaces/symbols)
    const alphanumeric = finalDeobfuscated.replace(/[^a-z0-9]/g, '');

    return {
        original: text,
        lowercase: processed,
        deobfuscated: finalDeobfuscated,
        condensed: alphanumeric
    };
}

/**
 * Performs a deep scan of the text across all normalized forms.
 * @returns {boolean} True if text appears safe.
 */
export function deepGuard(text, blocklist, filterLibrary) {
    if (!text) return true;

    const forms = normalizeForSafety(text);
    
    // Layer 1: Raw Library Check
    if (filterLibrary.check(forms.original)) return false;
    
    // Layer 2: De-obfuscated Library Check
    if (filterLibrary.check(forms.deobfuscated)) return false;

    // Layer 3: Blocklist Substring Probing (Multi-layered forms)
    const checkForms = [forms.lowercase, forms.deobfuscated, forms.condensed];
    
    for (const word of blocklist) {
        if (checkForms.some(f => f.includes(word))) return false;
    }

    // Layer 4: Heuristic - Check for common spacing bypasses (e.g. "s h i t")
    // If the condensed version has a word from the blocklist, it's a hit
    // (Handled by the condensed check in Layer 3)

    return true;
}
