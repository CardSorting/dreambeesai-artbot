import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "./logger.js";

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
        s3ClientInstance = new S3Client({
            endpoint: B2_ENDPOINT,
            region: B2_REGION || 'us-west-004',
            credentials: {
                accessKeyId: B2_KEY_ID,
                secretAccessKey: B2_APP_KEY,
            },
        });
    }
    return s3ClientInstance;
};

export async function uploadToS3(filename, buffer, retries = 3) {
    const s3 = getS3Client();
    if (!B2_BUCKET) throw new Error("B2_BUCKET is not configured in environment variables.");
    
    try {
        await s3.send(new PutObjectCommand({ 
            Bucket: B2_BUCKET, 
            Key: filename, 
            Body: buffer, 
            ContentType: "image/webp" 
        }));
        return `${B2_PUBLIC_URL}/file/${B2_BUCKET}/${filename}`;
    } catch (err) {
        if (retries > 0) {
            logger.info(`Retrying S3 upload for ${filename}. Retries left: ${retries - 1}`, { bucket: B2_BUCKET });
            return uploadToS3(filename, buffer, retries - 1);
        }
        logger.error(`S3 upload failed for ${filename}`, err, { bucket: B2_BUCKET, bufferSize: buffer.length });
        throw err;
    }
}

