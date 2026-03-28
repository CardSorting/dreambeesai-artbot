import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import admin from 'firebase-admin';
import fetch from 'node-fetch';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger.js';

dotenv.config();

/**
 * 🐝 DreamBees Hive Node: Full-Stack Health Diagnostics
 * This script performs live connectivity tests for all mission-critical dependencies.
 */

async function runHealthCheck() {
    logger.info("🐝 Starting DreamBees Hive Health Check...");
    let overallSuccess = true;

    // 1. Firebase Admin SDK Check
    try {
        logger.info("📂 [1/4] Testing Firestore Connectivity...");
        const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(process.cwd(), './serviceAccountKey.json');
        const projectId = process.env.GCLOUD_PROJECT || 'dreambees-alchemist';

        if (!admin.apps.length) {
            let credential;
            if (saJson) credential = admin.credential.cert(JSON.parse(saJson));
            else if (fs.existsSync(saPath)) credential = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
            else credential = admin.credential.applicationDefault();

            admin.initializeApp({ credential, projectId });
        }

        const db = admin.firestore();
        const probeRef = db.collection('_health').doc('diagnostics');
        const now = new Date().toISOString();
        
        await probeRef.set({ lastCheck: now, status: 'healthy' });
        const snap = await probeRef.get();
        
        if (snap.exists && snap.data().lastCheck === now) {
            logger.info("✅ Firestore Read/Write: SUCCESS");
        } else {
            throw new Error("Firestore data mismatch after write.");
        }
    } catch (err) {
        logger.error("❌ Firestore Test: FAILED", { error: err.message });
        overallSuccess = false;
    }

    // 2. Discord Gateway Connectivity
    try {
        logger.info("📡 [2/4] Testing Discord Token & Gateway...");
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        
        const loginPromise = client.login(process.env.DISCORD_TOKEN);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Discord login timed out.")), 10000));
        
        await Promise.race([loginPromise, timeoutPromise]);
        logger.info(`✅ Discord Login: SUCCESS (Logged in as ${client.user.tag})`);
        await client.destroy();
    } catch (err) {
        logger.error("❌ Discord Test: FAILED", { error: err.message });
        overallSuccess = false;
    }

    // 3. DreamBees Backend API
    try {
        logger.info("🛰️ [3/4] Testing DreamBees Backend API...");
        const apiUrl = process.env.DREAMBEES_API_URL || 'https://dreambeesai.com/api';
        const apiKey = process.env.DREAMBEES_API_KEY;

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
            body: JSON.stringify({ data: { action: 'ping' } })
        });

        if (res.ok) {
            logger.info("✅ Backend API: SUCCESS (Ping received)");
        } else {
            const body = await res.text();
            logger.warn(`⚠️ Backend API: Warning (${res.status})`, { body: body.substring(0, 100) });
            // Ping might not be implemented, but 200/400/401 means it's reachable
            if (res.status === 401 || res.status === 403) {
                logger.error("❌ Backend API: Authentication Failed (Invalid API Key)");
                overallSuccess = false;
            } else if (res.status >= 500) {
                overallSuccess = false;
            }
        }
    } catch (err) {
        logger.error("❌ Backend API Test: FAILED", { error: err.message });
        overallSuccess = false;
    }

    // 4. S3/B2 Storage Bucket
    try {
        logger.info("📦 [4/4] Testing S3/B2 Storage Bucket Access...");
        const s3 = new S3Client({
            endpoint: `https://${process.env.B2_ENDPOINT}`,
            region: process.env.B2_REGION || 'us-east-005',
            credentials: {
                accessKeyId: process.env.B2_KEY_ID,
                secretAccessKey: process.env.B2_APP_KEY
            }
        });

        await s3.send(new HeadBucketCommand({ Bucket: process.env.B2_BUCKET }));
        logger.info(`✅ Storage Bucket: SUCCESS (Bucket '${process.env.B2_BUCKET}' reachable)`);
    } catch (err) {
        logger.error("❌ Storage Test: FAILED", { error: err.message });
        overallSuccess = false;
    }

    if (overallSuccess) {
        logger.info("✨ HIVE STATUS: MISSION READY! All systems operational. 🐝");
        process.exit(0);
    } else {
        logger.error("⚠️ HIVE STATUS: DEGRADED. Some systems reported failures.");
        process.exit(1);
    }
}

runHealthCheck().catch(err => {
    logger.error("FATAL ERROR during health check", { error: err.message, stack: err.stack });
    process.exit(1);
});
