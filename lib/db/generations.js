import { db, admin } from '../firebase.js';

/**
 * Saves a generation's metadata to Firestore.
 */
export async function saveGeneration(interactionId, data) {
    await db.collection('discord_generations').doc(interactionId).set({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Retrieves generation metadata from Firestore.
 * @param {string} interactionId - The interaction ID to look up.
 * @returns {Promise<Object|null>}
 */
export async function getGeneration(interactionId) {
    const doc = await db.collection('discord_generations').doc(interactionId).get();
    return doc.exists ? doc.data() : null;
}

/**
 * Adds a report for a generation and returns the new report count.
 * @param {string} interactionId - The interaction ID being reported.
 * @param {Object} reportData - Metadata about the reporter.
 * @returns {Promise<number>} The total number of reports for this interaction.
 */
export async function addReport(interactionId, reportData) {
    const reportRef = db.collection('reported_generations').doc(interactionId);
    return await db.runTransaction(async (t) => {
        const snap = await t.get(reportRef);
        let count = 1;
        let reporters = [reportData.reportedBy];

        if (snap.exists) {
            const data = snap.data();
            if (data.reporters && data.reporters.includes(reportData.reportedBy)) {
                return data.count || 0; // User already reported
            }
            count = (data.count || 0) + 1;
            reporters = [...(data.reporters || []), reportData.reportedBy];
        }

        t.set(reportRef, {
            ...reportData,
            count,
            reporters,
            lastReportedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return count;
    });
}
