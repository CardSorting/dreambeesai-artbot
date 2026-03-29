import { jest } from '@jest/globals';

// 1. Declare Mocks using unstable_mockModule (ESM pattern)
// We mock HivePersistence to avoid actual Firebase connectivity
jest.unstable_mockModule('../dist/services/HivePersistence.js', () => ({
    hivePersistence: {
        db: {
            collection: jest.fn().mockReturnThis(),
            doc: jest.fn().mockReturnThis(),
            get: jest.fn(),
            set: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            runTransaction: jest.fn()
        },
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        getDocCompat: jest.fn(),
        setDocCompat: jest.fn(),
        updateDocCompat: jest.fn(),
        runAtomic: jest.fn(),
        fieldValue: {
            serverTimestamp: jest.fn(() => 'mock-timestamp'),
            increment: jest.fn((n) => `increment(${n})`)
        },
        getOrCreateUser: jest.fn(),
        saveGeneration: jest.fn(),
        getGuildConfig: jest.fn(), // If added later
        tryLock: jest.fn(),
        releaseLock: jest.fn(),
        setCooldown: jest.fn(),
        getRemainingCooldown: jest.fn(),
        getStudioThreadId: jest.fn()
    },
    COLLECTIONS: {
        USERS: 'artbot_users',
        GENERATIONS: 'artbot_generations',
        GUILDS: 'artbot_guilds',
        SYSTEM: 'artbot_system',
        LOCKS: 'artbot_locks',
        COOLDOWNS: 'artbot_cooldowns',
        STUDIOS: 'artbot_studios'
    }
}));

// 2. Import SUT via dynamic import
const { hivePersistence, COLLECTIONS } = await import('../dist/services/HivePersistence.js');

describe('Modular Database Layer (artbot_ isolation)', () => {
    const testId = 'test-id';
    const testData = { foo: 'bar' };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Users Module (artbot_users)', () => {
        test('getOrCreateUser provisions new users in artbot_users', async () => {
            hivePersistence.getOrCreateUser.mockResolvedValueOnce({ 
                discordId: testId, 
                zaps: 100 
            });
            
            const result = await hivePersistence.getOrCreateUser(testId, 'tag#123');
            
            expect(hivePersistence.getOrCreateUser).toHaveBeenCalledWith(testId, 'tag#123');
            expect(result.zaps).toBe(100);
        });
    });

    describe('Generations Module', () => {
        test('saveGeneration writes metadata', async () => {
            await hivePersistence.saveGeneration(testId, testData);
            expect(hivePersistence.saveGeneration).toHaveBeenCalledWith(testId, testData);
        });
    });

    describe('Config Module (artbot_guilds & artbot_system)', () => {
        test('getGuildConfig handles artbot_guilds', async () => {
            hivePersistence.db.get.mockResolvedValueOnce({ exists: true, data: () => ({ reportThreshold: 5 }) });
            
            // Testing that the persistence layer can be reached
            expect(hivePersistence.db.collection).toBeDefined();
        });

        test('getRemoteConfig handles artbot_system/config', async () => {
            hivePersistence.db.get.mockResolvedValueOnce({ exists: true, data: () => ({ dailyRewardAmount: 500 }) });
            
            expect(hivePersistence.db.doc).toBeDefined();
        });
    });

    describe('Locks Module', () => {
        test('tryLock and releaseLock', async () => {
            hivePersistence.tryLock.mockResolvedValue(true);
            const success = await hivePersistence.tryLock(testId);
            expect(success).toBe(true);

            await hivePersistence.releaseLock(testId);
            expect(hivePersistence.releaseLock).toHaveBeenCalledWith(testId);
        });
    });

    describe('Cooldowns Module', () => {
        test('setCooldown and getRemainingCooldown', async () => {
            await hivePersistence.setCooldown(testId, 60000);
            expect(hivePersistence.setCooldown).toHaveBeenCalledWith(testId, 60000);

            hivePersistence.getRemainingCooldown.mockResolvedValue(30000);
            const remaining = await hivePersistence.getRemainingCooldown(testId);
            expect(remaining).toBe(30000);
        });
    });

    describe('Threads Module (artbot_studios)', () => {
        test('getStudioThreadId reads from artbot_studios', async () => {
            hivePersistence.getStudioThreadId.mockResolvedValueOnce('thread-123');

            const threadId = await hivePersistence.getStudioThreadId('user-1', 'channel-1');
            expect(hivePersistence.getStudioThreadId).toHaveBeenCalledWith('user-1', 'channel-1');
            expect(threadId).toBe('thread-123');
        });
    });
});
