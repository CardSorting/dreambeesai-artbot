import { jest } from '@jest/globals';

// 1. Declare Mocks using unstable_mockModule (ESM pattern)
jest.unstable_mockModule('../dist/services/HivePersistence.js', () => ({
    hivePersistence: {
        debit: jest.fn(),
        refund: jest.fn(),
        claimDaily: jest.fn(),
        precision: jest.fn(n => Math.round(n * 100) / 100)
    }
}));

// 2. Import SUT and Mocked Modules via dynamic import
const { hivePersistence } = await import('../dist/services/HivePersistence.js');

describe('Wallet HivePersistence Operations', () => {
    const uid = 'test-user';
    const requestId = 'req-123';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('debit()', () => {
        test('should succeed if balance is sufficient', async () => {
            hivePersistence.debit.mockResolvedValue({ success: true });
            const result = await hivePersistence.debit(uid, 10, requestId);
            expect(result.success).toBe(true);
            expect(hivePersistence.debit).toHaveBeenCalledWith(uid, 10, requestId);
        });

        test('should fail if insufficient balance', async () => {
            hivePersistence.debit.mockResolvedValue({ success: false, error: 'Insufficient Zaps' });
            const result = await hivePersistence.debit(uid, 1000, requestId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Insufficient Zaps');
        });
    });

    describe('refund()', () => {
        test('should successfuly refund a debit', async () => {
            hivePersistence.refund.mockResolvedValue(true);
            const result = await hivePersistence.refund(requestId, 'Test refund');
            expect(result).toBe(true);
        });
    });

    describe('claimDaily()', () => {
        test('should allow daily claim', async () => {
            hivePersistence.claimDaily.mockResolvedValue({ 
                success: true, 
                rewardAmount: 100, 
                newStreak: 1, 
                newBalance: 100 
            });

            const result = await hivePersistence.claimDaily(uid, { guildId: 'guild-1' });
            expect(result.success).toBe(true);
            expect(result.newStreak).toBe(1);
        });
    });
});
