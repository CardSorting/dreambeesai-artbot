import { HiveEngine } from './core/HiveEngine.js';

/**
 * THE SPARK
 * Initializes and ignites the Sovereign Hive.
 */
const hive = new HiveEngine();
hive.start().catch((err: any) => {
    console.error('FATAL: Hive Engine failed to ignite.', err);
    process.exit(1);
});
