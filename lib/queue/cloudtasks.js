import { CloudTasksClient } from '@google-cloud/tasks';
import { logger } from '../logger.js';

const client = new CloudTasksClient();

/**
 * Creates a Google Cloud Task for image generation.
 */
export async function createCloudTask(payload) {
    const project = process.env.GCLOUD_PROJECT;
    const location = process.env.CLOUD_TASKS_LOCATION;
    const queue = process.env.CLOUD_TASKS_QUEUE;
    const url = process.env.TASK_WEBHOOK_URL || `${process.env.WEBAPP_URL}/tasks/process-generation`;
    const serviceAccountEmail = process.env.CLOUD_TASKS_SA_EMAIL;

    // PRODUCTION HARDENING: Fail fast if critical config is missing
    if (!project || !location || !queue) {
        throw new Error(`Cloud Tasks configuration error: Missing GCLOUD_PROJECT, CLOUD_TASKS_LOCATION, or CLOUD_TASKS_QUEUE`);
    }

    if (!serviceAccountEmail && process.env.NODE_ENV === 'production') {
        throw new Error(`Cloud Tasks security error: CLOUD_TASKS_SA_EMAIL is required for OIDC in production`);
    }

    const parent = client.queuePath(project, location, queue);

    const task = {
        httpRequest: {
            httpMethod: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
            oidcToken: {
                // In production, we MUST use a specific SA. In development, we can try to use appspot default if missing.
                serviceAccountEmail: serviceAccountEmail || `${project}@appspot.gserviceaccount.com`,
                audience: url // HARDENING: Explicitly verify the audience matches the domain webhook
            },
        },
    };

    logger.info(`[CloudTasks] Enqueuing task: ${payload.requestId}`, { queue, url });

    try {
        const [response] = await client.createTask({ parent, task });
        logger.info(`[CloudTasks] Task successfully created`, { taskName: response.name });
        return response;
    } catch (error) {
        logger.error(`[CloudTasks] Dispatch failed`, { error: error.message, requestId: payload.requestId });
        throw error;
    }
}
