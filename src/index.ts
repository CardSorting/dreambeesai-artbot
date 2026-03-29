import { HiveEngine } from './core/HiveEngine.js';
import { Logger } from './core/Logger.js';

const logger = new Logger();

async function bootstrap() {
    try {
        const hive = new HiveEngine();
        await hive.start();
    } catch (err) {
        logger.error('CRITICAL: Bootstrapping failed.', err);
        process.exit(1);
    }
}

bootstrap();
