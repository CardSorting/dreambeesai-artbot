import { jest } from '@jest/globals';

// 1. Declare Mocks using unstable_mockModule (MUST come before we import the SUT in ESM)
jest.unstable_mockModule('../lib/firebase.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        runTransaction: jest.fn(),
        batch: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            commit: jest.fn().mockResolvedValue({})
        })
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

jest.unstable_mockModule('../lib/db/config.js', () => ({
    getRemoteConfig: jest.fn().mockResolvedValue({ 
        dailyRewardAmount: 100, 
        streakBonusAmount: 10, 
        maxStreakBonus: 100 
    })
}));

// 2. Import SUT and Mocked Modules via dynamic import
const { Wallet } = await import('../lib/wallet.js');
const { db } = await import('../lib/firebase.js');

describe('Wallet Class', () => {
    const uid = 'test-user';
    const requestId = 'req-123';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('debit should fail if user not found', async () => {
        db.runTransaction.mockImplementation(async (callback) => {
            const t = {
                get: jest.fn().mockResolvedValue({ exists: false })
            };
            return callback(t);
        });

        await expect(Wallet.debit(uid, 10, requestId))
            .rejects.toThrow('Discord User not found.');
    });

    test('debit should succeed if balance is sufficient', async () => {
        db.runTransaction.mockImplementation(async (callback) => {
            const t = {
                get: jest.fn()
                    .mockResolvedValueOnce({ exists: false }) // transactionRef
                    .mockResolvedValueOnce({ 
                        exists: true, 
                        data: () => ({ zaps: 100 }) 
                    }), // userRef
                update: jest.fn(),
                set: jest.fn()
            };
            const result = await callback(t);
            return result;
        });

        const result = await Wallet.debit(uid, 10, requestId);
        expect(result.success).toBe(true);
        expect(result.newBalance).toBe(90);
    });

    test('debit should throw if insufficient balance', async () => {
        db.runTransaction.mockImplementation(async (callback) => {
            const t = {
                get: jest.fn()
                    .mockResolvedValueOnce({ exists: false })
                    .mockResolvedValueOnce({ 
                        exists: true, 
                        data: () => ({ zaps: 5 }) 
                    })
            };
            return callback(t);
        });

        await expect(Wallet.debit(uid, 10, requestId))
            .rejects.toThrow(/Insufficient zaps/);
    });
});
