/**
 * Structured Logger for Discord Bot Production
 * Provides uniform JSON logging for easier ingestion by Cloud Logging / Datadog / etc.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const levels: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');
const reset = '\x1b[0m';

const SECRET_KEYS = [
    'api-key', 'api_key', 'token', 'secret', 'password', 'x-api-key', 'authorization', 
    'bearer', 'access_token', 'refresh_token', 'id_token', 'credentials', 'uuid', 
    'key_id', 'auth_', 'cookie', 'session'
];

/**
 * Robust Data Scrubbing with Circular Reference Safety and Depth Limit
 */
function scrubData(data: any, depth = 0, maxDepth = 5, visited = new WeakSet()): any {
    if (depth >= maxDepth) return '[DEPTH_LIMIT_REACHED]';
    if (!data || typeof data !== 'object') return data;
    
    // Prevent infinite recursion on circular objects
    if (visited.has(data)) return '[CIRCULAR_REF]';
    visited.add(data);

    const isArray = Array.isArray(data);
    const scrubbed = isArray ? [] : {} as any;
    
    if (isArray) {
        for (let i = 0; i < data.length; i++) {
            scrubbed.push(scrubData(data[i], depth + 1, maxDepth, visited));
        }
    } else {
        for (const key in data) {
            if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
            const value = data[key];
            const lowerKey = key.toLowerCase();
            
            if (SECRET_KEYS.some(sk => lowerKey.includes(sk))) {
                scrubbed[key] = '[SCRUBBED]';
            } else if (value && typeof value === 'object' && !(value instanceof Error)) {
                scrubbed[key] = scrubData(value, depth + 1, maxDepth, visited);
            } else {
                scrubbed[key] = value;
            }
        }
    }
    return scrubbed;
}

export interface LoggerContext {
    traceId?: string;
    [key: string]: any;
}

export class Logger {
    constructor(private baseContext: LoggerContext = {}) {}

    private log(level: LogLevel, message: string, data: any = {}) {
        if (levels[level] < levels[currentLevel]) return;

        const scrubbedData = scrubData(data);
        const payload: any = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...scrubData(this.baseContext),
            ...scrubbedData
        };

        // EXTREME HARDENING: Auto-inject trace_id if present in context
        if (this.baseContext.traceId) {
            payload.trace_id = this.baseContext.traceId;
        }

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
            const traceSuffix = payload.trace_id ? ` [tr:${payload.trace_id}]` : '';
            // Don't stringify Error objects in console output to avoid clutter, but show their message
            const dataToPrint = data instanceof Error ? { message: data.message } : data;
            process.stdout.write(`${color}[${level}]${reset} ${payload.timestamp} | ${message}${traceSuffix} ${Object.keys(dataToPrint).length > 0 ? JSON.stringify(dataToPrint) : ''}\n`);
        }
    }

    trace(msg: string, data?: any) { this.log('DEBUG', msg, data); }
    debug(msg: string, data?: any) { this.log('DEBUG', msg, data); }
    info(msg: string, data?: any) { this.log('INFO', msg, data); }
    warn(msg: string, data?: any) { this.log('WARN', msg, data); }
    error(msg: string, data?: any) { this.log('ERROR', msg, data); }

    child(extraContext: LoggerContext): Logger {
        return new Logger({ ...this.baseContext, ...extraContext });
    }

    withTrace(traceId?: string): Logger {
        return new Logger({ 
            ...this.baseContext, 
            traceId: traceId || `tr_${Date.now()}_${Math.random().toString(36).substring(7)}` 
        });
    }
}

export const logger = new Logger();
