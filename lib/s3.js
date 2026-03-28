import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "./logger.js";
import { abortableSleep } from "./utils.js";

const B2_ENDPOINT = process.env.B2_ENDPOINT;
const B2_REGION = process.env.B2_REGION;
const B2_BUCKET = process.env.B2_BUCKET;
const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APP_KEY = process.env.B2_APP_KEY;
export const B2_PUBLIC_URL = process.env.B2_PUBLIC_URL;

let s3ClientInstance = null;

export const getS3Client = () => {
    if (!s3ClientInstance) {
        if (!B2_KEY_ID || !B2_APP_KEY || !B2_ENDPOINT) {
            logger.warn("Missing B2 orientation in environment variables. Uploads will fail if attempted.");
        }
        const endpoint = B2_ENDPOINT.startsWith('http') ? B2_ENDPOINT : `https://${B2_ENDPOINT}`;
        s3ClientInstance = new S3Client({
            endpoint,
            region: B2_REGION || 'us-west-004',
            credentials: {
                accessKeyId: B2_KEY_ID,
                secretAccessKey: B2_APP_KEY,
            },
        });
    }
    return s3ClientInstance;
};

export async function uploadToS3(filename, buffer, options = {}) {
    const { maxRetries = 3, signal } = options;
    const s3 = getS3Client();
    if (!B2_BUCKET) throw new Error("B2_BUCKET is not configured in environment variables.");
    
    let attempt = 0;
    while (attempt <= maxRetries) {
        if (signal?.aborted) throw new Error('Upload aborted');
        
        try {
            await s3.send(new PutObjectCommand({ 
                Bucket: B2_BUCKET, 
                Key: filename, 
                Body: buffer, 
                ContentType: "image/webp" 
            }), { abortSignal: signal }); // AWS SDK supports abortSignal
            
            return `${B2_PUBLIC_URL}/file/${B2_BUCKET}/${filename}`;
        } catch (err) {
            if (err.name === 'AbortError' || signal?.aborted) throw err;
            
            attempt++;
            if (attempt > maxRetries) {
                logger.error(`S3 upload failed for ${filename} after ${maxRetries} attempts`, { 
                    error: err.message, 
                    bucket: B2_BUCKET, 
                    bufferSize: buffer.length 
                });
                throw err;
            }
            const delay = attempt * 500; // 500ms, 1000ms, 1500ms
            logger.info(`Retrying S3 upload for ${filename} (Attempt ${attempt}/${maxRetries}) in ${delay}ms...`);
            await abortableSleep(delay, signal);
        }
    }
}

