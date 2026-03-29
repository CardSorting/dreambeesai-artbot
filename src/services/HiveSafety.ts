import { Logger } from '../core/Logger.js';
import { hivePersistence } from './HivePersistence.js';
import { UserProfile } from '../models/index.js';

const logger = new Logger();

// --- Static Data & Mappings (Consolidated from safety-blocklist.js) ---
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD]/gu;
const LEET_MAP: Record<string, string> = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
    '$': 's', '@': 'a', '!': 'i', '|': 'i', '(': 'c', '{': 'c', '[': 'c',
    '#': 'h', '*': 'a', '+': 't', 'v': 'v', 'w': 'w', 'cl': 'd', 'vv': 'w',
    'rn': 'm', 'q': 'g'
};

const PHONETIC_MAP: Record<string, string> = {
    'ph': 'p', 'ck': 'k', 'kn': 'n', 'wh': 'w', 'sh': 's', 'th': 't'
};

const JAILBREAK_SIGNATURES = /ignore previous|jailbreak|skip safety|dan:|system prompt|override safety|force generation/gi;

export const SAFETY_BLOCKLIST = [
    'porn', 'nsfw', 'p0rn', 'sex', 'sexual', 'hentai', 'nude', 'naked', 
    'erotica', 'undress', 'lingerie', 'fetish', 'bdsm', 'rape', 'incest', 
    'pedophelia', 'child', 'molest', 'voyeur', 'bestiality', 'gore', 
    'murder', 'suicide', 'abuse', 'torture', 'mutilation', 'slaughter',
    'nazi', 'faggot', 'retard', 'tranny', 'nigga', 'nigger', 'kkk'
];

/**
 * MONOLITHIC PILLAR: HiveSafety
 * Consolidates all protection, auditing, and input sanitation.
 */
export class HiveSafety {
    /**
     * Aegis: Wraps user input in safety tags and redacts common injection strings.
     */
    static wrapInAegis(text: string): string {
        if (!text) return '';
        const stripped = text
            .normalize('NFKC')
            .replace(INVISIBLE_CHARS, '')
            .replace(JAILBREAK_SIGNATURES, '[REDACTED]');
        return `<user_input>${stripped}</user_input>`;
    }

    /**
     * Nectar: Sanitizes prompts by keeping only safe characters.
     */
    static refineNectar(text: string): string {
        if (!text) return '';
        return text
            .replace(/[^a-zA-Z0-9\s.,!?'"()/+-]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Normalizes text for safety scanning by de-obfuscating leet-speak.
     */
    static normalize(text: string) {
        let processed = text.normalize('NFKC').toLowerCase();
        let deobfuscated = '';
        for (const char of processed) {
            deobfuscated += LEET_MAP[char] || char;
        }
        let phonetic = deobfuscated;
        for (const [key, val] of Object.entries(PHONETIC_MAP)) {
            phonetic = phonetic.split(key).join(val);
        }
        return { original: text, deobfuscated, phonetic };
    }

    /**
     * Queen's Guard: Scans a prompt against blocklists.
     * Purely analytical.
     */
    static async guardHive(prompt: string) {
        if (!prompt) return { approved: false, matchedTerm: 'empty' };
        if (prompt.length > 500) return { approved: false, matchedTerm: 'length' };

        const forms = this.normalize(prompt);
        const promptLower = forms.deobfuscated;

        for (const term of SAFETY_BLOCKLIST) {
            if (promptLower.includes(term) || forms.phonetic.includes(term)) {
                return { approved: false, matchedTerm: term };
            }
        }

        return { approved: true };
    }

    /**
     * Throttling: Check for active ban or high-velocity strike backoff.
     * Purely analytical.
     */
    static async getAbuseBackoff(user: UserProfile): Promise<number> {
        const strikes = user.abuseStrikes || 0;
        const lastStrikeAt = (user as any).lastStrikeAt?.toDate()?.getTime() || 0;

        if (strikes < 3 || !lastStrikeAt) return 0;
        let cooldownMs = strikes >= 10 ? 7200000 : strikes >= 5 ? 1800000 : 300000;
        const elapsed = Date.now() - lastStrikeAt;
        return Math.max(0, cooldownMs - elapsed);
    }
}
