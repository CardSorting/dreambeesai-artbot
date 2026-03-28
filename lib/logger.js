/**
 * Structured Logger for Discord Bot Production
 * Provides uniform JSON logging for easier ingestion by Cloud Logging / Datadog / etc.
 */

const levels = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');
const reset = '\x1b[0m';

const SECRET_KEYS = ['api-key', 'api_key', 'token', 'secret', 'password', 'x-api-key', 'authorization', 'bearer', 'access_token', 'refresh_token', 'id_token', 'credentials'];

/**
 * Robust Data Scrubbing with Circular Reference Safety
 */
function scrubData(data, visited = new WeakSet()) {
    if (!data || typeof data !== 'object') return data;
    
    // Prevent infinite recursion on circular objects
    if (visited.has(data)) return '[CIRCULAR_REF]';
    visited.add(data);

    const scrubbed = Array.isArray(data) ? [] : {};
    
    for (const [key, value] of Object.entries(data)) {
        if (SECRET_KEYS.some(sk => key.toLowerCase().includes(sk))) {
            scrubbed[key] = '[SCRUBBED]';
        } else if (value && typeof value === 'object' && !(value instanceof Error)) {
            scrubbed[key] = scrubData(value, visited);
        } else {
            scrubbed[key] = value;
        }
    }
    return scrubbed;
}

export function createLogger(baseContext = {}) {
    function log(level, message, data = {}) {
        if (levels[level] < levels[currentLevel]) return;

        const scrubbedData = scrubData(data);
        const payload = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...scrubData(baseContext),
            ...scrubbedData
        };

        // Handle error objects
        if (data instanceof Error) {
            payload.error = { message: data.message, stack: data.stack };
        } else if (data.err instanceof Error) {
            payload.error = { message: data.err.message, stack: data.err.stack };
            delete payload.err;
        }

        if (process.env.NODE_ENV === 'production') {
            process.stdout.write(JSON.stringify(payload) + '\n');
        } else {
            const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[36m';
            process.stdout.write(`${color}[${level}]${reset} ${payload.timestamp} | ${message} ${Object.keys(data).length > 0 ? JSON.stringify(data) : ''}\n`);
        }
    }

    return {
        debug: (msg, data) => log('DEBUG', msg, data),
        info: (msg, data) => log('INFO', msg, data),
        warn: (msg, data) => log('WARN', msg, data),
        error: (msg, data) => log('ERROR', msg, data),
        child: (extraContext) => createLogger({ ...baseContext, ...extraContext })
    };
}

export const logger = createLogger();
