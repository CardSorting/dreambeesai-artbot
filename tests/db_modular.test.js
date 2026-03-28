import { jest } from '@jest/globals';

// 1. Declare Mocks using unstable_mockModule (ESM pattern)
jest.unstable_mockModule('../lib/firebase.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        batch: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            commit: jest.fn().mockResolvedValue({})
        }),
        runTransaction: jest.fn()
    },
    admin: {
        firestore: {
            FieldValue: {
                serverTimestamp: jest.fn(() => 'mock-timestamp')
            }
        }
    },
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

// 2. Import Modular SUTs via dynamic import
const { getUserByDiscordId, getOrCreateDiscordUser } = await import('../lib/db/users.js');
const { saveGeneration, getGeneration, addReport } = await import('../lib/db/generations.js');
const { getGuildConfig, setGuildConfig, getRemoteConfig } = await import('../lib/db/config.js');
const { tryLock, releaseLock, cleanupStaleLocks } = await import('../lib/db/locks.js');
const { setCooldown, getRemainingCooldown } = await import('../lib/db/cooldowns.js');
const { getStudioThreadId, setStudioThreadId } = await import('../lib/db/threads.js');
const { db } = await import('../lib/firebase.js');

describe('Modular Database Layer (artbot_ isolation)', () => {
    const testId = 'test-id';
    const testData = { foo: 'bar' };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Users Module (artbot_users)', () => {
        test('getUserByDiscordId checks artbot_users collection', async () => {
            db.get.mockResolvedValueOnce({ exists: true, id: testId, data: () => testData });
            
            const result = await getUserByDiscordId(testId);
            
            expect(db.collection).toHaveBeenCalledWith('artbot_users');
            expect(db.doc).toHaveBeenCalledWith(testId);
            expect(result.uid).toBe(testId);
        });

        test('getOrCreateDiscordUser provision new users in artbot_users', async () => {
            db.get.mockResolvedValueOnce({ exists: false }); // User not found
            
            await getOrCreateDiscordUser(testId, 'tag#123', 'photo-url');
            
            expect(db.collection).toHaveBeenCalledWith('artbot_users');
            expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
                discordId: testId,
                zaps: 100 // Provisioned Zaps
            }));
        });
    });

    describe('Generations Module (artbot_generations & artbot_reports)', () => {
        test('saveGeneration writes to artbot_generations', async () => {
            await saveGeneration(testId, testData);
            expect(db.collection).toHaveBeenCalledWith('artbot_generations');
            expect(db.set).toHaveBeenCalledWith(expect.objectContaining(testData));
        });

        test('addReport uses artbot_reports and handles logic', async () => {
            db.runTransaction.mockImplementation(async (cb) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    set: jest.fn()
                };
                return cb(t);
            });

            await addReport(testId, { reportedBy: 'reporter-1' });
            expect(db.collection).toHaveBeenCalledWith('artbot_reports');
        });
    });

    describe('Config Module (artbot_guilds & artbot_system)', () => {
        test('getGuildConfig handles artbot_guilds', async () => {
            db.get.mockResolvedValueOnce({ exists: true, data: () => ({ reportThreshold: 5 }) });
            
            const config = await getGuildConfig('guild-123');
            expect(db.collection).toHaveBeenCalledWith('artbot_guilds');
            expect(config.reportThreshold).toBe(5);
        });

        test('getRemoteConfig handles artbot_system/config', async () => {
            db.get.mockResolvedValueOnce({ exists: true, data: () => ({ dailyRewardAmount: 500 }) });
            
            const config = await getRemoteConfig();
            expect(db.collection).toHaveBeenCalledWith('artbot_system');
            expect(db.doc).toHaveBeenCalledWith('config');
            expect(config.dailyRewardAmount).toBe(500);
        });
    });

    describe('Locks Module (artbot_locks)', () => {
        test('tryLock acquire in artbot_locks', async () => {
            db.runTransaction.mockImplementation(async (cb) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    set: jest.fn()
                };
                return cb(t);
            });

            const success = await tryLock(testId);
            expect(db.collection).toHaveBeenCalledWith('artbot_locks');
            expect(success).toBe(true);
        });

        test('releaseLock delete from artbot_locks', async () => {
            await releaseLock(testId);
            expect(db.collection).toHaveBeenCalledWith('artbot_locks');
            expect(db.delete).toHaveBeenCalled();
        });
    });

    describe('Cooldowns Module (artbot_cooldowns)', () => {
        test('setCooldown writes to artbot_cooldowns', async () => {
            await setCooldown(testId, 60000);
            expect(db.collection).toHaveBeenCalledWith('artbot_cooldowns');
            expect(db.set).toHaveBeenCalled();
        });

        test('getRemainingCooldown reads from artbot_cooldowns', async () => {
            const endsAt = new Date(Date.now() + 30000);
            db.get.mockResolvedValueOnce({ 
                exists: true, 
                data: () => ({ endsAt: { toDate: () => endsAt } }) 
            });

            const remaining = await getRemainingCooldown(testId);
            expect(db.collection).toHaveBeenCalledWith('artbot_cooldowns');
            expect(remaining).toBeGreaterThan(0);
        });
    });

    describe('Threads Module (artbot_studios)', () => {
        test('getStudioThreadId reads from artbot_studios', async () => {
            db.get.mockResolvedValueOnce({ 
                exists: true, 
                data: () => ({ threadId: 'thread-123' }) 
            });

            const threadId = await getStudioThreadId('user-1', 'channel-1');
            expect(db.collection).toHaveBeenCalledWith('artbot_studios');
            expect(threadId).toBe('thread-123');
        });
    });
});
