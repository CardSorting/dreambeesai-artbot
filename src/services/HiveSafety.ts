/**
 * PILLAR MODEL: UserProfile
 */
export interface UserProfile {
    uid: string;
    discordId: string;
    discordTag?: string;
    photoURL?: string | null;
    zaps: number;
    joinedAt: any; 
    lastActive: any; 
    abuseStrikes?: number;
    lastStrikeAt?: any;
}

/**
 * PILLAR UTILITY: Internalized Logger
 */
export class Logger {
    constructor(private ctx: any = {}) {}
    private log(level: string, message: string, data: any = {}) {
        const payload = { timestamp: new Date().toISOString(), level, message, ...this.ctx, ...data };
        if (process.env.NODE_ENV === 'production') process.stdout.write(JSON.stringify(payload) + '\n');
        else process.stdout.write(`[${level}] ${message} ${Object.keys(data).length ? JSON.stringify(data) : ''}\n`);
    }
    info(m: string, d?: any) { this.log('INFO', m, d); }
    warn(m: string, d?: any) { this.log('WARN', m, d); }
    error(m: string, d?: any) { this.log('ERROR', m, d); }
}

const logger = new Logger();

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

// --- Sovereign Risk Categories ---
export const SAFETY_POLICIES = {
    NSFW: ['porn', 'nsfw', 'p0rn', 'sex', 'sexual', 'hentai', 'nude', 'naked', 'erotica', 'undress', 'lingerie', 'fetish', 'bdsm'],
    VIOLENCE: ['rape', 'incest', 'pedophelia', 'child', 'molest', 'voyeur', 'bestiality', 'gore', 'murder', 'suicide', 'abuse', 'torture', 'mutilation', 'slaughter'],
    HATE: ['nazi', 'faggot', 'retard', 'tranny', 'nigga', 'nigger', 'kkk'],
    EVASION: ['ignore previous', 'jailbreak', 'skip safety', 'dan:', 'system prompt', 'override safety', 'force generation']
};

/**
 * MONOLITHIC PILLAR: HiveSafety (Sovereign Shield)
 * Consolidates all risk assessment, de-obfuscation, and contextual policy logic.
 */
export interface RiskProfile {
    score: number;
    approved: boolean;
    reason: string;
    sanitized: string;
    category: 'CLEAN' | 'NSFW' | 'VIOLENCE' | 'HATE' | 'EVASION';
    heatScale: number;
}

export class HiveSafety {
    private static readonly BLOCK_THRESHOLD = 10;
    private static readonly HEAT_MAP = new Map<string, { count: number, lastRejection: number }>();
    
    /**
     * HEURISTIC: Contextual Heat Meter
     * Tracks rapid rejections for a user to increase the "Heat Scale."
     */
    static getHeat(userId: string): number {
        const entry = this.HEAT_MAP.get(userId);
        if (!entry) return 0;
        const elapsed = Date.now() - entry.lastRejection;
        if (elapsed > 300000) return 0; // Cool down after 5 mins
        return Math.min(entry.count, 5);
    }

    static recordRejection(userId: string) {
        const entry = this.HEAT_MAP.get(userId) || { count: 0, lastRejection: 0 };
        this.HEAT_MAP.set(userId, { count: entry.count + 1, lastRejection: Date.now() });
    }

    /**
     * Autonomous Risk Analysis
     */
    static analyze(text: string, userId?: string): RiskProfile {
        if (!text) return { score: 0, approved: true, reason: 'empty', sanitized: '', category: 'CLEAN', heatScale: 0 };
        
        const original = text;
        const normalized = this.normalize(text);
        const heatScale = userId ? this.getHeat(userId) : 0;
        
        let score = 0;
        let category: any = 'CLEAN';
        let matchedTerm = '';

        // 1. Policy Scan (Cross-Category)
        for (const [pool, terms] of Object.entries(SAFETY_POLICIES)) {
            for (const term of terms) {
                if (normalized.deobfuscated.includes(term) || normalized.phonetic.includes(term)) {
                    score += (pool === 'EVASION' ? 50 : 15);
                    score += (heatScale * 5); // Multiplier for repeat offenders
                    category = pool;
                    matchedTerm = term;
                    break;
                }
            }
            if (score >= this.BLOCK_THRESHOLD) break;
        }

        const approved = score < this.BLOCK_THRESHOLD;
        if (!approved && userId) this.recordRejection(userId);

        return {
            score,
            approved,
            reason: approved ? 'clean' : `${category}_DETECTION: ${matchedTerm}`,
            sanitized: this.refineNectar(original),
            category,
            heatScale
        };
    }

    /**
     * NECTAR ENRICHMENT (The HiveMind)
     * Heuristically injects style tokens into prompts to ensure a "Dream HQ" standard.
     */
    static enrich(prompt: string, modelId: string): string {
        const enrichment = [
            'highly detailed',
            'digital art',
            '4k resolution',
            'cinematic lighting',
            'masterpiece'
        ];
        
        // Don't over-enrich if it's already complex
        if (prompt.split(' ').length > 40) return prompt;
        
        return `${prompt}, ${enrichment.join(', ')}`;
    }

    /**
     * Strike Policy: Determines the consequences of a safety failure.
     */
    static calculateStrikeWeight(profile: RiskProfile): number {
        if (profile.category === 'EVASION') return 5; // Heavy weight for evasion/jailbreak
        if (profile.category === 'HATE') return 3;    // High weight for hate speech
        if (profile.score >= 30) return 2;             // Severe policy breach
        return 1; // Standard violation
    }

    /**
     * Throttling: Check for active ban or high-velocity strike backoff.
     */
    static async getAbuseBackoff(user: UserProfile): Promise<number> {
        const strikes = user.abuseStrikes || 0;
        const strikeObj = (user as any).lastStrikeAt;
        const lastStrikeAt = strikeObj?.toDate?.()?.getTime() || Number(strikeObj) || 0;

        if (strikes < 3 || !lastStrikeAt) return 0;
        
        // Exponential complexity in backoff
        // 3 strikes = 5 mins, 5 strikes = 30 mins, 10 strikes = 2 hours, 20+ = 24 hours
        let cooldownMs = 300000;
        if (strikes >= 20) cooldownMs = 86400000;
        else if (strikes >= 10) cooldownMs = 7200000;
        else if (strikes >= 5) cooldownMs = 1800000;
        
        const elapsed = Date.now() - lastStrikeAt;
        return Math.max(0, cooldownMs - elapsed);
    }

    /**
     * Aegis: Sanitization Wrapper
     */
    static refineNectar(text: string): string {
        return text
            .replace(INVISIBLE_CHARS, '')
            .replace(/[^a-zA-Z0-9\s.,!?'"()/+-]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private static normalize(text: string) {
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
}
