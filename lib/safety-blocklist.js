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
    '\u043E': 'o', '\u1D21': 'v', '\u1D1C': 'u', '\u2133': 'm', '\u210D': 'h',
    // ⓐⓑⓒⓓⓔ Circled
    '\u24D0': 'a', '\u24D1': 'b', '\u24D2': 'c', '\u24D3': 'd', '\u24D4': 'e', '\u24D5': 'f', '\u24D6': 'g', '\u24D7': 'h', '\u24D8': 'i', '\u24D9': 'j', '\u24DA': 'k', '\u24DB': 'l', '\u24DC': 'm', '\u24DD': 'n', '\u24DE': 'o', '\u24DF': 'p', '\u24E0': 'q', '\u24E1': 'r', '\u24E2': 's', '\u24E3': 't', '\u24E4': 'u', '\u24E5': 'v', '\u24E6': 'w', '\u24E7': 'x', '\u24E8': 'y', '\u24E9': 'z',
    // 𝓅 𝓆 𝓇 𝓈 𝓉 𝓊 𝓋 Script (Small)
    '\uD835\uDCF1': 'h', '\uD835\uDCF2': 'i', '\uD835\uDCF3': 'j', '\uD835\uDCF4': 'k', '\uD835\uDCF5': 'l', '\uD835\uDCF6': 'm', '\uD835\uDCF7': 'n', '\uD835\uDCF8': 'o', '\uD835\uDCF9': 'p', '\uD835\uDCFA': 'q', '\uD835\uDCFB': 'r', '\uD835\uDCFC': 's', '\uD835\uDCFD': 't', '\uD835\uDCFE': 'u', '\uD835\uDCFF': 'v', 
    // 𝖕 𝖖 𝖗 𝖘 𝖙 𝖚 Fraktur (Small)
    '\uD835\uDD13': 'p', '\uD835\uDD14': 'q', '\uD835\uDD15': 'r', '\uD835\uDD16': 's', '\uD835\uDD17': 't', '\uD835\uDD18': 'u'
};

const PHONETIC_MAP = {
    'ph': 'p', 'ck': 'k', 'kn': 'n', 'wh': 'w', 'sh': 's', 'th': 't', 'cs': 'x', 'ts': 's'
};

const INSTRUCTIONAL_OVERRIDES = /ignore previous|jailbreak|skip safety|dan:|system prompt|override safety|unfilter|disable guardrails|bypass filter|force generation|dan 6.0/gi;

const SAFE_ARTISTIC_PHRASES = /blood red|blood moon|death star|skull and crossbones|dead center|raid boss|skeleton key|afterlife|graveyard shift|grim reaper|red liquid|crimson splash|fallen warrior|battle-scarred/gi;

const SAFE_PHRASAL_CONTEXT = {
    'tit': ['blue tit', 'great tit', 'coal tit', 'marsh tit', 'long-tailed tit', 'tit bird'],
    'shag': ['shag rug', 'shag carpet', 'shag bird', 'shag haircut'],
    'cock': ['cocktail', 'cockpit', 'peacock', 'rooster', 'shuttlecock', 'weathercock'],
    'cum': ['circumstance', 'document', 'accumulate', 'cucumber', 'cucumber water'],
    'balls': ['soccer ball', 'basket ball', 'crystal ball', 'glass ball', 'snowball', 'fireball', 'golf ball', 'tennis ball', 'pool ball'],
    'piss': ['pistachio', 'pissaro'],
    'oral': ['floral', 'coral', 'moral', 'immoral', 'ephemeral'],
    'nude': ['nude palette', 'nude color', 'nude tones', 'nude makeup', 'nude lipstick', 'nude study', 'classical nude'],
    'naked': ['naked eye', 'naked branch', 'naked mole rat', 'naked truth', 'naked tree'],
    'execution': ['artistic execution', 'flawless execution', 'code execution', 'software execution']
};

const ARTISTIC_CONTEXT_KEYWORDS = [
    'oil painting', 'digital art', 'cinematic', 'lens flare', 'highly detailed', 
    'photography', 'canvas', 'sculpture', 'sketch', 'watercolor', 'masterpiece',
    'unreal engine', 'octane render', 'photorealistic', 'hyperrealistic', 'concept art'
];

/**
 * Common phrases where safe word boundaries naturally form a blocked token (Scunthorpe problem).
 */
const CROSS_WORD_EXCLUSIONS = /flawless execution|less excited|mass exchange|this experience|business expansion|analysis|analytical|multitude|quantity|titular|titbird|shag rug|shag carpet|pissaro|pistachio|cucumber|floral|coral|moral/gi;

const JAILBREAK_SIGNATURES = /act as if|now you are|stay in character|unmasked mode|limitless|no constraints|disregard guidelines|fictional scenario|unfiltered|uncensored|unmasked|dan 6\.0/gi;

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
        'gore', 'murder', 'suicide', 'abuse', 'torture', 'mutilation', 'slaughter',
        'decapitated', 'beheaded', 'corpse', 'guillotine', 'amputation', 
        'autopsy', 'cannibal', 'disemboweled', 'execution', 'gutted', 'hanging', 
        'stabbing', 'strangling', 'snuff', 'terrorist', 'assassin', 'fatal', 
        'genocide', 'homicide', 'massacre', 'poison', 'savagery', 
        'vengeance', 'laceration', 'viscera', 'hemorrhage', 'intestines'
    ],
    ARTISTIC_VIOLENCE: [
        'bloody', 'blood', 'death', 'dead', 'kill', 'killing', 'raid', 'violent', 'violence'
    ],
    SUGGESTIVE: [
        'lingerie', 'vixen', 'bikini', 'swimsuit', 'cleavage', 'provocative', 'suggestive'
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
export const INSTANT_BLOCK_TERMS = [
    'porn', 'nsfw', 'p0rn', 'hentai', 'rape', 'incest', 'pedophelia', 'child', 
    'molest', 'voyeur', 'bestiality', 'snuff', 'terrorist', 'nazi', 'kkk', 
    'white power', 'nigger', 'faggot', 'retard', 'tranny'
];

export const HIGH_RISK_TERMS = [
    ...SAFETY_CATEGORIES.SEXUAL.filter(t => !['lingerie', 'vixen', 'swimsuit', 'nude', 'naked'].includes(t)),
    ...SAFETY_CATEGORIES.VIOLENCE,
    ...SAFETY_CATEGORIES.HATE,
    'nude', 'naked', 'murder', 'suicide', 'abuse', 'torture', 'mutilation', 'slaughter', 'execution'
].filter(t => !INSTANT_BLOCK_TERMS.includes(t));

export const MEDIUM_RISK_TERMS = [
    ...SAFETY_CATEGORIES.ARTISTIC_VIOLENCE,
    ...SAFETY_CATEGORIES.SUGGESTIVE
];

export const SAFETY_BLOCKLIST = [...new Set([...HIGH_RISK_TERMS, ...MEDIUM_RISK_TERMS])];

// 4. Core Logic Functions

/**
 * Advanced normalization with repeating character collapse and phonetic approximation.
 */
export function normalizeForSafety(text) {
    if (!text) return { original: '', lowercase: '', deobfuscated: '', condensed: '', collapsed: '', phonetic: '', indices: [] };

    let stripped = text.replace(INVISIBLE_CHARS, '');
    let normalized = stripped.normalize('NFKC');
    let processed = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // Leet Map & Metadata Tracking (Code Point Aware)
    let resolved = '';
    let indices = []; // Index of each alpha character in the original string
    let head = 0;
    
    for (const char of processed) {
        const resolvedChar = LEET_MAP[char] || char;
        resolved += resolvedChar;
        if (/[a-z0-9]/.test(resolvedChar)) {
            // Track the original start position of this character/surrogate pair
            indices.push(head);
        }
        head += char.length; // Handles surrogate pairs (+2) vs BPM (+1)
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
        phonetic: phoneticCollapsed,
        indices: indices
    };
}

/**
 * Executes a full Queen's Guard fortification scan on a prompt.
 */
export async function executeQueenGuardScan(prompt, filterLibrary = null) {
    if (!prompt) return { approved: false, matchedTerm: 'empty', score: 0 };

    // 0. MAX PROMPT LENGTH SENTINEL
    // Prevents "Buffer Overflow" prompt injections where massive inputs bypass filters.
    const MAX_PROMPT_LENGTH = 500;
    if (prompt.length > MAX_PROMPT_LENGTH) {
        return { 
            approved: false, 
            matchedTerm: 'length_limit_exceeded', 
            score: 100, 
            error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters.` 
        };
    }

    if (INSTRUCTIONAL_OVERRIDES.test(prompt)) {
        return { approved: false, matchedTerm: 'instructional_override', score: RISK_WEIGHTS.OVERRIDE_ATTEMPT };
    }
    
    const promptLower = prompt.toLowerCase();
    for (const phrase of RESTRICTED_PHRASES) {
        if (promptLower.includes(phrase)) {
            return { approved: false, matchedTerm: `phrase:${phrase}`, score: 100 };
        }
    }

    if (JAILBREAK_SIGNATURES.test(promptLower)) {
        return { approved: false, matchedTerm: 'jailbreak_signature', score: RISK_WEIGHTS.OVERRIDE_ATTEMPT };
    }

    if (SAFE_ARTISTIC_PHRASES.test(prompt)) {
        // Safe Artistic Phrase detected! This provides a bypass for common creative idioms.
        return { approved: true, score: 0, matchedTerm: 'artistic_whitelist' };
    }

    const forms = normalizeForSafety(prompt);
    let score = 0;
    
    if (filterLibrary) {
        // Reduced library pass: only check literal and deobfuscated forms.
        // Generic libraries like leo-profanity are prone to false positives 
        // in condensed/collapsed forms (e.g., "anal" in "analysis").
        const libraryPasses = [prompt, forms.deobfuscated];
        for (const pass of libraryPasses) {
            if (filterLibrary.check(pass)) return { approved: false, matchedTerm: `library_pass`, score: 100 };
        }
    }

    const artisticContext = ARTISTIC_CONTEXT_KEYWORDS.some(kw => promptLower.includes(kw));
    const allTerms = [...new Set([...INSTANT_BLOCK_TERMS, ...HIGH_RISK_TERMS, ...MEDIUM_RISK_TERMS])];
    const categoriesMatched = new Set();

    for (const term of allTerms) {
        const isHighRisk = HIGH_RISK_TERMS.includes(term);
        const wordRegex = new RegExp(`\\b${term}\\b`, 'i');
        
        // 1. Literal & Deobfusicated Match
        if (wordRegex.test(forms.lowercase) || wordRegex.test(forms.deobfuscated)) {
            // Check Phrasal Whitelist first
            const safePhrases = SAFE_PHRASAL_CONTEXT[term];
            const isWhitelisted = safePhrases && safePhrases.some(phrase => forms.lowercase.includes(phrase));
            
            if (!isWhitelisted) {
                const category = getCategory(term);
                if (category) categoriesMatched.add(category);
                
                // INSTANT BLOCK: Skip scoring and return immediately for extreme threats
                if (INSTANT_BLOCK_TERMS.includes(term)) {
                    return { approved: false, matchedTerm: `word:${term}`, score: 1000, category };
                }

                if (HIGH_RISK_TERMS.includes(term)) {
                    score += RISK_WEIGHTS.HIGH;
                } else {
                    score += RISK_WEIGHTS.MEDIUM;
                }
            }
        }
        
        // 2. Fragment & Bypass Scan (Enhanced for Substring Awareness)
        const condensedIndex = forms.condensed.indexOf(term);
        if (condensedIndex !== -1) {
            // Check if the characters are contiguous in the original/deobfuscated string.
            // If they are contiguous, it's likely a safe substring (e.g., 'anal' in 'analysis').
            const startIdx = forms.indices[condensedIndex];
            const endIdx = forms.indices[condensedIndex + term.length - 1];
            const originalSpanLen = (endIdx - startIdx) + 1;

            if (originalSpanLen > term.length) {
                // Check if this "bypass" is actually a natural crossing of safe words (Scunthorpe problem).
                const originalSpan = forms.deobfuscated.substring(startIdx, endIdx + 1);
                const nonAlphaInSpan = originalSpan.replace(/[a-z0-9]/g, '');
                
                // Allow a single space or hyphen in common false positive tokens if it's in a known safe phrase.
                const isMinorGap = nonAlphaInSpan.length === 1 && (nonAlphaInSpan === ' ' || nonAlphaInSpan === '-');
                if (isMinorGap && CROSS_WORD_EXCLUSIONS.test(forms.lowercase)) {
                    continue; // Natural word boundary crossing, likely safe.
                }

                // Non-contiguous: An obvious bypass attempt using spacing/punctuation!
                return { approved: false, matchedTerm: `bypass:${term}`, score: RISK_WEIGHTS.BYPASS_ATTEMPT, category: getCategory(term) };
            }
        }

        // Check phonetic & collapsed forms (intentional bypasses like 'phorn' or 'a.n.a.l')
        // We only check these if the term wasn't already found in condensed, 
        // to avoid double-triggering safe substrings like 'anal' in 'analysis'.
        if (!forms.condensed.includes(term)) {
            if (forms.collapsed.includes(term) || forms.phonetic.includes(term)) {
                return { approved: false, matchedTerm: `bypass:${term}`, score: RISK_WEIGHTS.BYPASS_ATTEMPT, category: getCategory(term) };
            }
        }

        // 3. Robust Scatter Scan (Allow any skip character if high risk)
        if (INSTANT_BLOCK_TERMS.includes(term) || HIGH_RISK_TERMS.includes(term) || term.length > 3) {
            // More aggressive scatter: only allow non-alphanumeric skip characters between target letters
            const scatterRegex = new RegExp(term.split('').join('[^a-z0-9]{0,3}'), 'i');
            const match = forms.deobfuscated.match(scatterRegex);
            if (match && !wordRegex.test(forms.deobfuscated)) {
                // If the match length equals term length, it's literal (e.g., 'anal' in 'analysis')
                // We only block if length > term.length (implying bypass noise)
                if (match[0].length > term.length) {
                    // Bypass attempts are always HIGH risk
                    return { approved: false, matchedTerm: `scatter:${term}`, score: RISK_WEIGHTS.BYPASS_ATTEMPT, category: getCategory(term) };
                }
            }
        }
    }

    // Multi-Category Bonus (Compound Risk)
    if (categoriesMatched.size >= 2) {
        score += (categoriesMatched.size - 1) * 20;
    }

    // Artistic Context Reduction (0.7x multiplier for Violence/Suggestive if in art context)
    if (artisticContext && score > 0) {
        // Only apply context boost to Violence/Suggestive categories
        const hasViolentOrSuggestive = [...categoriesMatched].some(cat => ['VIOLENCE', 'SUGGESTIVE', 'ARTISTIC_VIOLENCE'].includes(cat));
        if (hasViolentOrSuggestive) {
            score = Math.floor(score * 0.7);
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
