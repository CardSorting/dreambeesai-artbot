import { Wallet } from '../lib/wallet.js';
import { db } from '../lib/db.js';

// Mock Firestore
jest.mock('../lib/db.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        runTransaction: jest.fn()
    }
}));

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
            .rejects.toThrow('DreamBees User not found.');
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
