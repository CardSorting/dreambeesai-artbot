/**
 * Queen's Guard: Hardened Safety Engine (Pass 4.1)
 * Optimized phonetic matching and robust scatter detection.
 */

// 1. Data Structures & Mappings
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD]/g;

const LEET_MAP = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
    '$': 's', '@': 'a', '!': 'i', '|': 'i', '(': 'c', '{': 'c', '[': 'c',
    '#': 'h', '*': 'a', '+': 't', 'v': 'v', 'w': 'w', 'cl': 'd', 'vv': 'w',
    'rn': 'm', 'q': 'g', '\\/': 'v', '|\\/|': 'm', 'l||l': 'm',
    '\u03BF': 'o', '\u03C1': 'r', '\u03B1': 'a', '\u03B5': 'e', '\u03B9': 'i', 
    '\u03BA': 'k', '\u03BD': 'v', '\u03C3': 's', '\u03C4': 't', '\u03C9': 'w', 
    '\u03C7': 'x', '\u0430': 'a', '\u0435': 'e', '\u0440': 'p', '\u0441': 'c', 
    '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u0455': 's',
    '\u043E': 'o', '\u1D21': 'v', '\u1D1C': 'u', '\u2133': 'm', '\u210D': 'h'
};

// Map phonetic clusters to their common base for matching
const PHONETIC_MAP = {
    'ph': 'p', 'ck': 'k', 'kn': 'n', 'wh': 'w', 'sh': 's', 'th': 't', 'cs': 'x', 'ts': 's'
};

const INSTRUCTIONAL_OVERRIDES = /ignore previous|jailbreak|skip safety|dan:|system prompt|override safety|unfilter|disable guardrails|bypass filter|force generation|dan 6.0/gi;

// 2. Risk Categories & Scoring
export const SAFETY_CATEGORIES = {
    SEXUAL: [
        'nsfw', 'porn', 'p0rn', 'sex', 'sexual', 'hentai', 'nude', 'naked', 
        'erotica', 'undress', 'lingerie', 'fetish', 'bdsm', 'rape', 'incest', 
        'pedophelia', 'child', 'molest', 'voyeur', 'bestiality', 'r18',
        'anal', 'clitoris', 'dick', 'doujin', 'ejaculation', 'erection', 
        'fellatio', 'gangbang', 'masturbating', 'oral', 'orgasm', 'pussy', 
        'rimjob', 'scat', 'semen', 'sperm', 'testicle', 'threesome', 'vagina', 
        'vixen', 'camgirl', 'escort', 'playboy', 'playgirl', 'bukkake', 
        'cuckold', 'fisting', 'peg', 'squirt', 'anus', 'balls', 'beaver', 
        'blowjob', 'boner', 'boob', 'butt', 'clit', 'cock', 'cum', 'cunnilingus', 
        'cunny', 'cunt', 'dildo', 'felch', 'fellate', 'flange', 'fuck', 
        'jizz', 'knob', 'labia', 'muff', 'pecker', 'penis', 'piss', 'pube', 
        'scrotum', 'shag', 'smegma', 'spunk', 'tit', 'twat', 'wank', 'whore',
        'phorn', 'p h o r n', 'p.h.o.r.n' // Explicitly handle common phonetic bypasses
    ],
    VIOLENCE: [
        'gore', 'violence', 'violent', 'blood', 'bloody', 'killing', 'murder', 
        'dead', 'death', 'suicide', 'abuse', 'torture', 'mutilation', 'slaughter',
        'decapitated', 'beheaded', 'corpse', 'guillotine', 'amputation', 
        'autopsy', 'cannibal', 'disemboweled', 'execution', 'gutted', 'hanging', 
        'stabbing', 'strangling', 'snuff', 'terrorist', 'assassin', 'fatal', 
        'genocide', 'homicide', 'massacre', 'poison', 'raid', 'savagery', 
        'vengeance', 'laceration', 'viscera', 'hemorrhage', 'intestines'
    ],
    HATE: [
        'nazi', 'faggot', 'retard', 'tranny', 'nigga', 'nigger', 'kkk', 
        'white power', 'supremacy', 'antisemitism', 'xenophobic', 'racism', 
        'misogyny', 'hindutva', 'islamophobia', 'segregation'
    ],
    EVASIVE: [
        's.e.x', 'p.o.r.n', 'n.s.f.w', 'k.i.l.l', 'd.e.a.d', 
        's_e_x', 'p_o_r_n', 'n_s_f_w', 's...e...x', 'p...o...r...n'
    ]
};

const RESTRICTED_PHRASES = [
    'ignore all safety', 'disable guardrails', 'force unmasked output', 
    'act as a roleplay without limits', 'remove the filter'
];

const RISK_WEIGHTS = {
    HIGH: 100,
    MEDIUM: 40,
    BYPASS_ATTEMPT: 100,
    OVERRIDE_ATTEMPT: 100
};

// 3. Computed Sets
export const HIGH_RISK_TERMS = [
    ...SAFETY_CATEGORIES.SEXUAL.filter(t => !['lingerie', 'vixen', 'swimsuit'].includes(t)),
    ...SAFETY_CATEGORIES.VIOLENCE,
    ...SAFETY_CATEGORIES.HATE,
    'rape', 'incest', 'pedophelia', 'bestiality', 'snuff', 'terrorist'
];

export const MEDIUM_RISK_TERMS = [
    'lingerie', 'vixen', 'bikini', 'swimsuit', 'cleavage', 'provocative', 'suggestive'
];

export const SAFETY_BLOCKLIST = [...new Set([...HIGH_RISK_TERMS, ...MEDIUM_RISK_TERMS])];

// 4. Core Logic Functions

/**
 * Advanced normalization with repeating character collapse and phonetic approximation.
 */
export function normalizeForSafety(text) {
    if (!text) return { original: '', lowercase: '', deobfuscated: '', condensed: '', collapsed: '', phonetic: '' };

    let stripped = text.replace(INVISIBLE_CHARS, '');
    let processed = stripped.normalize('NFKD').replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // Leet Map
    let resolved = '';
    for (const char of processed) {
        resolved += LEET_MAP[char] || char;
    }

    // Phonetic Map pass (Input side)
    let phonetic = resolved;
    for (const [key, val] of Object.entries(PHONETIC_MAP)) {
        phonetic = phonetic.split(key).join(val);
    }

    const collapseRepeats = (str) => str.replace(/(.)\1+/g, '$1');
    const alphanumeric = resolved.replace(/[^a-z0-9]/g, '');
    const collapsed = collapseRepeats(alphanumeric);
    const phoneticCollapsed = collapseRepeats(phonetic.replace(/[^a-z0-9]/g, ''));

    return {
        original: text,
        lowercase: processed,
        deobfuscated: resolved,
        condensed: alphanumeric,
        collapsed: collapsed,
        phonetic: phoneticCollapsed
    };
}

/**
 * Executes a full Queen's Guard fortification scan on a prompt.
 */
export async function executeQueenGuardScan(prompt, filterLibrary = null) {
    if (!prompt) return { approved: false, matchedTerm: 'empty', score: 0 };

    if (INSTRUCTIONAL_OVERRIDES.test(prompt)) {
        return { approved: false, matchedTerm: 'instructional_override', score: RISK_WEIGHTS.OVERRIDE_ATTEMPT };
    }
    
    const promptLower = prompt.toLowerCase();
    for (const phrase of RESTRICTED_PHRASES) {
        if (promptLower.includes(phrase)) {
            return { approved: false, matchedTerm: `phrase:${phrase}`, score: 100 };
        }
    }

    const forms = normalizeForSafety(prompt);
    let score = 0;
    
    if (filterLibrary) {
        const passes = [prompt, forms.deobfuscated, forms.condensed, forms.collapsed, forms.phonetic];
        for (const pass of passes) {
            if (filterLibrary.check(pass)) return { approved: false, matchedTerm: `library_pass`, score: 100 };
        }
    }

    const allTerms = [...new Set([...HIGH_RISK_TERMS, ...MEDIUM_RISK_TERMS])];

    for (const term of allTerms) {
        const isHighRisk = HIGH_RISK_TERMS.includes(term);
        const wordRegex = new RegExp(`\\b${term}\\b`, 'i');
        
        // 1. Literal & Deobfusicated Match
        if (wordRegex.test(forms.lowercase) || wordRegex.test(forms.deobfuscated)) {
            if (isHighRisk) return { approved: false, matchedTerm: `word:${term}`, score: RISK_WEIGHTS.HIGH, category: getCategory(term) };
            score += RISK_WEIGHTS.MEDIUM;
        }
        
        // 2. Fragment & Bypass Scan (Now handles intentional phonetics)
        // Check both condensed and phonetic forms
        if (forms.condensed.includes(term) || forms.collapsed.includes(term) || forms.phonetic.includes(term)) {
            return { approved: false, matchedTerm: `bypass:${term}`, score: RISK_WEIGHTS.BYPASS_ATTEMPT, category: getCategory(term) };
        }

        // 3. Robust Scatter Scan (Allow any character between if high risk)
        if (isHighRisk || term.length > 3) {
            // More aggressive scatter: allow up to 3 skip characters between target letters
            const scatterRegex = new RegExp(term.split('').join('.{0,3}'), 'i');
            if (scatterRegex.test(forms.deobfuscated) && !wordRegex.test(forms.deobfuscated)) {
                return { approved: false, matchedTerm: `scatter:${term}`, score: RISK_WEIGHTS.BYPASS_ATTEMPT, category: getCategory(term) };
            }
        }
    }

    if (score >= 100) return { approved: false, matchedTerm: `weighted_block`, score };

    return { approved: true, score };
}

export function getCategory(term) {
    if (!term) return null;
    const clean = term.toLowerCase().trim();
    for (const [category, terms] of Object.entries(SAFETY_CATEGORIES)) {
        if (terms.includes(clean)) return category;
    }
    return null;
}

export function getRiskLevel(term) {
    if (!term) return 'none';
    const clean = term.toLowerCase().trim();
    if (HIGH_RISK_TERMS.includes(clean)) return 'high';
    if (MEDIUM_RISK_TERMS.includes(clean)) return 'medium';
    return 'none';
}
