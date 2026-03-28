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

    describe('debit()', () => {
        test('should fail if user not found', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ exists: false })
                };
                return callback(t);
            });

            await expect(Wallet.debit(uid, 10, requestId))
                .rejects.toThrow('Discord User not found.');
        });

        test('should succeed if balance is sufficient', async () => {
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
                return await callback(t);
            });

            const result = await Wallet.debit(uid, 10, requestId);
            expect(result.success).toBe(true);
            expect(result.newBalance).toBe(90);
        });

        test('should throw if insufficient balance', async () => {
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

        test('should handle idempotency for existing transaction', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ 
                        exists: true, 
                        data: () => ({ status: 'completed', newBalance: 90 }) 
                    })
                };
                return await callback(t);
            });

            const result = await Wallet.debit(uid, 10, requestId);
            expect(result.idempotent).toBe(true);
            expect(result.success).toBe(true);
            expect(result.newBalance).toBe(90);
        });
    });

    describe('credit()', () => {
        test('should credit balance and round to 2 decimals', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn()
                        .mockResolvedValueOnce({ exists: false }) // transactionRef
                        .mockResolvedValueOnce({ 
                            exists: true, 
                            data: () => ({ zaps: 10.1 }) 
                        }), // userRef
                    update: jest.fn(),
                    set: jest.fn()
                };
                return await callback(t);
            });

            const result = await Wallet.credit(uid, 0.2, requestId);
            expect(result.success).toBe(true);
            expect(result.newBalance).toBe(10.3); // 10.1 + 0.2 = 10.3
        });

        test('should handle idempotency', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ exists: true })
                };
                return await callback(t);
            });

            const result = await Wallet.credit(uid, 10, requestId);
            expect(result.idempotent).toBe(true);
        });
    });

    describe('refund()', () => {
        test('should successfuly refund a debit', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn()
                        .mockResolvedValueOnce({ 
                            exists: true, 
                            data: () => ({ type: 'debit', status: 'completed', amount: 10, userId: uid, currency: 'zaps' }) 
                        }) // txDoc
                        .mockResolvedValueOnce({ 
                            exists: true, 
                            data: () => ({ zaps: 50 }) 
                        }), // userDoc
                    update: jest.fn(),
                    set: jest.fn()
                };
                return await callback(t);
            });

            const result = await Wallet.refund(requestId, 'Test refund');
            expect(result.success).toBe(true);
            expect(result.newBalance).toBe(60);
        });

        test('should fail if original transaction not found', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ exists: false })
                };
                return callback(t);
            });

            await expect(Wallet.refund(requestId))
                .rejects.toThrow('Original transaction not found.');
        });

        test('should handle already refunded transactions gracefully', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ 
                        exists: true, 
                        data: () => ({ type: 'debit', status: 'refunded' }) 
                    })
                };
                return await callback(t);
            });

            const result = await Wallet.refund(requestId);
            expect(result.idempotent).toBe(true);
            expect(result.message).toBe('Already refunded.');
        });
    });

    describe('claimDaily()', () => {
        test('should allow initial claim (streak 1)', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn()
                        .mockResolvedValueOnce({ exists: false }) // claimDoc
                        .mockResolvedValueOnce({ 
                            exists: true, 
                            data: () => ({ zaps: 0, claimStreak: 0, lastFreeClaimAt: null }) 
                        }), // userDoc
                    update: jest.fn(),
                    set: jest.fn()
                };
                return await callback(t);
            });

            const result = await Wallet.claimDaily(uid);
            expect(result.success).toBe(true);
            expect(result.rewardAmount).toBe(100);
            expect(result.newStreak).toBe(1);
            expect(result.newBalance).toBe(100);
        });

        test('should increment streak if within 48h', async () => {
            const yesterday = new Date();
            yesterday.setHours(yesterday.getHours() - 25); // 25 hours ago

            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn()
                        .mockResolvedValueOnce({ exists: false })
                        .mockResolvedValueOnce({ 
                            exists: true, 
                            data: () => ({ 
                                zaps: 100, 
                                claimStreak: 1, 
                                lastFreeClaimAt: { toDate: () => yesterday } 
                            }) 
                        }),
                    update: jest.fn(),
                    set: jest.fn()
                };
                return await callback(t);
            });

            const result = await Wallet.claimDaily(uid);
            expect(result.newStreak).toBe(2);
            expect(result.rewardAmount).toBe(110); // 100 + (2-1)*10
        });

        test('should reset streak if after 48h', async () => {
            const longAgo = new Date();
            longAgo.setHours(longAgo.getHours() - 50); // 50 hours ago

            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn()
                        .mockResolvedValueOnce({ exists: false })
                        .mockResolvedValueOnce({ 
                            exists: true, 
                            data: () => ({ 
                                zaps: 1000, 
                                claimStreak: 10, 
                                lastFreeClaimAt: { toDate: () => longAgo } 
                            }) 
                        }),
                    update: jest.fn(),
                    set: jest.fn()
                };
                return await callback(t);
            });

            const result = await Wallet.claimDaily(uid);
            expect(result.newStreak).toBe(1);
            expect(result.rewardAmount).toBe(100);
        });

        test('should fail if already claimed today', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ exists: true }) // claimDoc
                };
                return callback(t);
            });

            await expect(Wallet.claimDaily(uid))
                .rejects.toThrow('You have already claimed your daily Zaps! Come back tomorrow.');
        });
    });

    describe('updateStatus()', () => {
        test('should update status from pending to completed', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ 
                        exists: true, 
                        data: () => ({ status: 'pending' }) 
                    }),
                    update: jest.fn()
                };
                await callback(t);
                expect(t.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'completed' }));
            });

            await Wallet.updateStatus(requestId, 'completed');
        });

        test('should not allow transition from completed to pending', async () => {
            db.runTransaction.mockImplementation(async (callback) => {
                const t = {
                    get: jest.fn().mockResolvedValue({ 
                        exists: true, 
                        data: () => ({ status: 'completed' }) 
                    }),
                    update: jest.fn()
                };
                await callback(t);
                expect(t.update).not.toHaveBeenCalled();
            });

            await Wallet.updateStatus(requestId, 'pending');
        });
    });
});
