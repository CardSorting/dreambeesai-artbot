import admin from 'firebase-admin';
import { applicationDefault } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

// Firebase initialization
let credential;
let db;
let adminInstance = admin;

// SILENCE FIRESTORE TELEMETRY: Resolve ENOENT: /non-existent-path bug on macOS
process.env.GOOGLE_CLOUD_FIRESTORE_TELEMETRY_DISABLED = 'true';

// Check for Service Account Key (File or JSON String)
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(process.cwd(), './serviceAccountKey.json');

const projectId = process.env.GCLOUD_PROJECT || 'dreambees-alchemist';

try {
    if (saJson) {
        credential = admin.credential.cert(JSON.parse(saJson));
    } else if (fs.existsSync(saPath)) {
        credential = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
    } else {
        // Fallback to Application Default Credentials (ADC)
        // Command: gcloud auth application-default login
        credential = applicationDefault();
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential,
            projectId: projectId
        });
    }
    db = admin.firestore();
    // Explicitly set the project ID for the Firestore instance to skip discovery lookups
    db.settings({ projectId, ignoreUndefinedProperties: true });
    
    logger.info(`Firebase initialized via Admin SDK (Project: ${projectId})`);
} catch (adminError) {
    if (adminError.message.includes("invalid_grant") || adminError.message.includes("reauth")) {
        logger.error("\n[CRITICAL] Firebase Auth Error: Your local 'gcloud' credentials have expired.");
        logger.error(">>> RESOLUTION: Please run 'gcloud auth application-default login' in your terminal.\n");
    } else {
        logger.warn("Admin SDK initialization failed. Attempting Web SDK fallback...", adminError.message);
    }

    // Fallback to Web SDK
    if (process.env.FIREBASE_API_KEY) {
        try {
            const { initializeApp } = await import('firebase/app');
            const { 
                getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, 
                query, where, limit, orderBy, getDocs, onSnapshot, addDoc,
                runTransaction, writeBatch, serverTimestamp, increment, arrayUnion, arrayRemove 
            } = await import('firebase/firestore');
            const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');

            const firebaseConfig = {
                apiKey: process.env.FIREBASE_API_KEY,
                authDomain: process.env.FIREBASE_AUTH_DOMAIN,
                projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
                messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
                appId: process.env.FIREBASE_APP_ID
            };

            const app = initializeApp(firebaseConfig);
            const webDb = getFirestore(app);

            // Optional: Auth sign-in if credentials provided
            if (process.env.FIREBASE_AUTH_EMAIL && process.env.FIREBASE_AUTH_PASSWORD) {
                const auth = getAuth(app);
                await signInWithEmailAndPassword(auth, process.env.FIREBASE_AUTH_EMAIL, process.env.FIREBASE_AUTH_PASSWORD);
                logger.info("Firebase Web SDK authenticated as user:", process.env.FIREBASE_AUTH_EMAIL);
            }

            // Create a shim to mimic the Admin SDK API
            const shimDoc = (coll, id) => {
                const docRef = doc(webDb, coll, id);
                return {
                    get: () => getDoc(docRef).then(s => ({ exists: s.exists(), data: () => s.data(), id: s.id, ref: s.ref })),
                    set: (data, opts) => setDoc(docRef, data, opts),
                    update: (data) => updateDoc(docRef, data),
                    delete: () => deleteDoc(docRef),
                    onSnapshot: (cb, err) => onSnapshot(docRef, s => cb({ exists: s.exists(), data: () => s.data(), id: s.id, ref: s.ref }), err),
                    collection: (name) => shimCollection(`${coll}/${id}/${name}`),
                    ref: docRef
                };
            };

            const shimCollection = (path) => {
                const colRef = collection(webDb, path);
                const wrapQueryResult = (q) => ({
                    limit: (n) => wrapQueryResult(query(q, limit(n))),
                    orderBy: (f, d) => wrapQueryResult(query(q, orderBy(f, d))),
                    where: (f, o, v) => wrapQueryResult(query(q, where(f, o, v))),
                    onSnapshot: (cb, err) => onSnapshot(q, s => cb({ 
                        empty: s.empty, 
                        docs: s.docs.map(d => ({ id: d.id, data: () => d.data(), ref: d.ref })), 
                        size: s.size 
                    }), err),
                    get: () => getDocs(q).then(s => ({ 
                        empty: s.empty, 
                        docs: s.docs.map(d => ({ id: d.id, data: () => d.data(), ref: d.ref })), 
                        size: s.size 
                    }))
                });

                return {
                    doc: (id) => shimDoc(path, id || Math.random().toString(36).substring(7)),
                    add: (data) => addDoc(colRef, data).then(ref => ({ id: ref.id, ref })),
                    ...wrapQueryResult(colRef)
                };
            };

            db = {
                collection: shimCollection,
                runTransaction: (callback) => runTransaction(webDb, async (t) => {
                    const webT = {
                        get: (refWrap) => t.get(refWrap.ref).then(s => ({
                            exists: s.exists(),
                            data: () => s.data(),
                            id: s.id,
                            ref: s.ref
                        })),
                        set: (refWrap, data, opts) => t.set(refWrap.ref, data, opts),
                        update: (refWrap, data) => t.update(refWrap.ref, data),
                        delete: (refWrap) => t.delete(refWrap.ref)
                    };
                    return callback(webT);
                }),
                batch: () => {
                    const b = writeBatch(webDb);
                    return {
                        set: (refWrap, data, opts) => { b.set(refWrap.ref, data, opts); return b; },
                        update: (refWrap, data) => { b.update(refWrap.ref, data); return b; },
                        delete: (refWrap) => { b.delete(refWrap.ref); return b; },
                        commit: () => b.commit()
                    };
                }
            };

            // Shim for FieldValue/serverTimestamp
            adminInstance = {
                firestore: {
                    FieldValue: {
                        serverTimestamp: () => serverTimestamp(),
                        increment: (n) => increment(n),
                        arrayUnion: (...elements) => arrayUnion(...elements),
                        arrayRemove: (...elements) => arrayRemove(...elements)
                    }
                }
            };

            logger.info("Firebase initialized via Web SDK (Shim Mode).");
        } catch (webError) {
            logger.error("FATAL: All Firebase initialization methods failed.", webError);
            throw webError;
        }
    } else {
        logger.error("FATAL: No Firebase credentials provided (Service Account, ADC, or Web API Key).");
        throw adminError;
    }
}

export { adminInstance as admin, logger, db };
