import 'dotenv/config';
import { hivePersistence } from '../src/services/HivePersistence.js';


async function testConnection() {
    console.log('--- HivePersistence: Admin User Auth Test ---');
    try {
        console.log('Verifying connectivity...');
        const isHealthy = await hivePersistence.verifyConnectivity();
        
        if (isHealthy) {
            console.log('✅ SUCCESS: Connected to Firestore via Admin User!');
            
            // Test a read
            console.log('Testing read (primeWarmCache)...');
            await hivePersistence.primeWarmCache();
            
            console.log('Test complete.');
            await hivePersistence.close();
            process.exit(0);
        } else {
            console.error('❌ FAILURE: Connectivity check failed.');
            await hivePersistence.close();
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ CRITICAL ERROR during test:', err);
        await hivePersistence.close();
        process.exit(1);
    }
}

testConnection();
