import 'dotenv/config';
import { hivePersistence } from '../src/services/HivePersistence.js';


async function testConnection() {
    console.log('--- HivePersistence: Admin User Auth Test ---');
    try {
        // The persistence layer initializes itself on import/first use.
        // We wait for a bit to ensure async init is done if it's triggerred.
        // Actually, HivePersistence.initialize is called in constructor and is async.
        // Wait, I made initialize 'private async' but didn't await it in constructor.
        // Let's check that.
        
        console.log('Verifying connectivity...');
        const isHealthy = await hivePersistence.verifyConnectivity();
        
        if (isHealthy) {
            console.log('✅ SUCCESS: Connected to Firestore via Admin User!');
            
            // Test a read
            console.log('Testing read (primeWarmCache)...');
            await hivePersistence.primeWarmCache();
            
            console.log('Test complete.');
        } else {
            console.error('❌ FAILURE: Connectivity check failed.');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ CRITICAL ERROR during test:', err);
        process.exit(1);
    }
}

testConnection();
