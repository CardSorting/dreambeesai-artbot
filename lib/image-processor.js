import sharp from 'sharp';
import pLimit from 'p-limit';
import { db, admin, COLLECTIONS } from './firebase.js';
import { uploadToS3 } from './s3.js';
import { logger } from './logger.js';

// CONCURRENCY CONTROL: Prevent OOM on memory-constrained instances
const imageLimit = pLimit(process.env.IMAGE_CONCURRENCY || 4);

// MEMORY OPTIMIZATION: Disable internal sharp cache for immediate disposal
sharp.cache(false);

/**
 * Pinnacle+ World-Class "Prism" Branding Pass.
 */
const WATERMARK_SVG = Buffer.from(`
<svg width="450" height="70">
  <defs>
    <filter id="glassBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
      <feComposite in="blur" in2="SourceGraphic" operator="over" />
    </filter>
    <filter id="crystalGrain" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="4" result="noise" />
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.12 0" />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>
    <linearGradient id="prismEdge" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ff00cc" stop-opacity="0.03" />
      <stop offset="50%" stop-color="#00ffff" stop-opacity="0.03" />
      <stop offset="100%" stop-color="#ffff00" stop-opacity="0.03" />
    </linearGradient>
    <linearGradient id="pinnaclePlusGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="white" stop-opacity="0.1" />
        <stop offset="40%" stop-color="white" stop-opacity="0.6" />
        <stop offset="60%" stop-color="white" stop-opacity="0.6" />
        <stop offset="100%" stop-color="white" stop-opacity="0.1" />
    </linearGradient>
  </defs>
  <rect x="145" y="10" width="300" height="42" rx="21" fill="url(#prismEdge)" />
  <rect x="148" y="12" width="294" height="38" rx="19" fill="white" fill-opacity="0.03" />
  <rect x="148" y="12" width="294" height="38" rx="19" fill="none" stroke="white" stroke-opacity="0.08" stroke-width="0.5" filter="url(#crystalGrain)" />
  <style>
    .text { 
        fill: url(#pinnaclePlusGrad); 
        font-family: 'Segoe UI', Arial, sans-serif; 
        font-size: 16px; 
        font-weight: 600; 
        letter-spacing: 7.2px;
        text-transform: uppercase;
        filter: drop-shadow(0 0 2px rgba(255,255,255,0.3));
    }
    .monogram { 
        stroke: url(#pinnaclePlusGrad);
        stroke-width: 1.8;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
  </style>
  <g transform="translate(170, 16) scale(0.65)" class="monogram">
     <path d="M10,20 Q20,5 30,20 Q20,35 10,20 Z" fill="white" fill-opacity="0.05" />
     <path d="M15,12 A10,10 0 0,1 25,12 M12,25 A12,8 0 0,0 28,25" />
     <circle cx="20" cy="20" r="1.5" fill="white" stroke="none" />
  </g>
  <text x="430" y="40" text-anchor="end" class="text">DREAMBEES AI</text>
</svg>
`);

/**
 * Applies branding to an image buffer.
 */
async function applyWatermark(buffer) {
    if (!buffer) return buffer;
    return await sharp(buffer)
        .composite([{ 
            input: WATERMARK_SVG, 
            gravity: 'southeast',
            blend: 'over'
        }])
        .toBuffer();
}

/**
 * Stitches 4 images into a 2x2 grid with branding.
 */
export async function stitchImages(buffers, options = {}) {
    return imageLimit(async () => {
        const { logger: ctxLogger = logger, signal } = options;
        if (!buffers || buffers.length !== 4) throw new Error("Need exactly 4 buffers to stitch");
        
        if (signal?.aborted) throw new Error("Stitching aborted by signal");
        
        try {
            const resized = await Promise.all(buffers.map(b => sharp(b).resize(1024, 1024).toBuffer()));
            
            // TELEMETRY: Audit processing load
            ctxLogger.info(`[ImageProcessor] Creating 2x2 grid`, { totalPixels: 2048 * 2048, components: buffers.length });

            const result = await sharp({
                create: { width: 2048, height: 2048, channels: 3, background: { r: 0, g: 0, b: 0 } }
            })
                .composite([
                    { input: resized[0], top: 0, left: 0 },
                    { input: resized[1], top: 0, left: 1024 },
                    { input: resized[2], top: 1024, left: 0 },
                    { input: resized[3], top: 1024, left: 1024 }
                ])
                .webp({ quality: 90 })
                .toBuffer();
            
            resized.length = 0; // Help memory management
            
            return applyWatermark(result);
        } catch (err) {
            ctxLogger.error("Grid Stitching Failed", err);
            throw new Error("Failed to create image grid.");
        }
    });
}

export async function validateImageBuffer(buffer, label) {
    try {
        await sharp(buffer).metadata();
    } catch (err) {
        logger.warn(`Invalid image buffer detected for ${label}`, { error: err.message });
        throw new Error(`Corrupt or invalid image buffer for ${label}`);
    }
}

export async function stitchSideBySide(buffer1, buffer2, options = {}) {
    return imageLimit(async () => {
        const { logger: ctxLogger = logger } = options;
        try {
            const img1 = sharp(buffer1);
            const img2 = sharp(buffer2);
            const meta1 = await img1.metadata();
            const meta2 = await img2.metadata();

            const targetHeight = Math.max(meta1.height, meta2.height);
            const targetWidthBase = Math.round(meta1.width * (targetHeight / meta1.height));
            const targetWidth2Base = Math.round(meta2.width * (targetHeight / meta2.height));

            const resImg1 = await img1.resize({ height: targetHeight }).toBuffer();
            const resImg2 = await img2.resize({ height: targetHeight }).toBuffer();

            const stitched = await sharp({
                create: {
                    width: targetWidthBase + targetWidth2Base,
                    height: targetHeight,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 1 }
                }
            })
            .composite([
                { input: resImg1, left: 0, top: 0 },
                { input: resImg2, left: targetWidthBase, top: 0 }
            ])
            .webp()
            .toBuffer();

            return applyWatermark(stitched);
        } catch (err) {
            ctxLogger.error("Side-by-Side Stitching Failed", err);
            throw new Error("Failed to weave images side-by-side.");
        }
    });
}

export async function stitchNarrativeStrip(buffers, options = {}) {
    return imageLimit(async () => {
        const { logger: ctxLogger = logger } = options;
        if (buffers.length < 2) return applyWatermark(buffers[0]);
        
        try {
            const sharpImages = buffers.map(b => sharp(b));
            const metadatas = await Promise.all(sharpImages.map(img => img.metadata()));
            
            const targetHeight = Math.max(...metadatas.map(m => m.height || 1024));
            const resizedBuffers = await Promise.all(sharpImages.map(async (img, i) => {
                const meta = metadatas[i];
                const newWidth = Math.round((meta.width || 1024) * (targetHeight / (meta.height || 1024)));
                return {
                    buffer: await img.resize({ height: targetHeight }).toBuffer(),
                    width: newWidth
                };
            }));

            const totalWidth = resizedBuffers.reduce((acc, curr) => acc + curr.width, 0);

            let currentLeft = 0;
            const compositeList = resizedBuffers.map(rb => {
                const item = { input: rb.buffer, left: currentLeft, top: 0 };
                currentLeft += rb.width;
                return item;
            });

            const strip = await sharp({
                create: { width: totalWidth, height: targetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } }
            })
            .composite(compositeList)
            .webp()
            .toBuffer();

            return applyWatermark(strip);
        } catch (err) {
            ctxLogger.error("Narrative Strip Stitching Failed", err);
            throw new Error("Failed to create narrative strip.");
        }
    });
}

export async function processAndUploadSingleImage(buffer, userId, metadata = {}) {
    return imageLimit(async () => {
        const { 
            prompt, negative_prompt, steps, cfg, aspectRatio, modelId, 
            requestId, promptHash, promptMetadata, shouldBookmark = false 
        } = metadata;

        try {
            const sharpImg = sharp(buffer);
            const meta = await sharpImg.metadata();
            
            // TELEMETRY: Audit incoming image specs
            logger.info(`[ImageProcessor] Processing generation results`, { 
                width: meta.width, 
                height: meta.height, 
                sizeKb: Math.round(buffer.length / 1024) 
            });

            const [webpBuffer, thumbBuffer, lqipBuffer] = await Promise.all([
                sharpImg.webp({ quality: 90 }).toBuffer(),
                sharpImg.resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
                sharpImg.resize(20, 20, { fit: 'inside' }).webp({ quality: 20 }).toBuffer()
            ]);

            const lqip = `data:image/webp;base64,${lqipBuffer.toString('base64')}`;
            const baseFolder = `generated/${userId}/${Date.now()}`;
            const originalFilename = `${baseFolder}.webp`;
            const thumbFilename = `${baseFolder}_thumb.webp`;

            const [imageUrl, thumbnailUrl] = await Promise.all([
                uploadToS3(originalFilename, webpBuffer),
                uploadToS3(thumbFilename, thumbBuffer)
            ]);

            const imageRef = await db.collection(COLLECTIONS.IMAGES).add({
                userId,
                prompt: prompt || "",
                negative_prompt: negative_prompt || null,
                steps: steps || 30,
                cfg: cfg || 7,
                aspectRatio: aspectRatio || "1:1",
                modelId: modelId || "wai-illustrious",
                imageUrl, thumbnailUrl, lqip, 
                promptHash: promptHash || null, 
                promptMetadata: promptMetadata || null,
                isPublic: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                originalRequestId: requestId || null
            });

            if (shouldBookmark && userId) {
                try {
                    // Unified Bookmark Storage: Subcollection of artbot_users
                    await db.collection(COLLECTIONS.USERS).doc(userId).collection("bookmarks").doc(imageRef.id).set({
                        imageId: imageRef.id,
                        imageUrl,
                        thumbnailUrl,
                        prompt,
                        aspectRatio,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        _autoGenerated: true
                    });
                } catch (bookmarkError) {
                    logger.error(`Failed to auto-bookmark image ${imageRef.id}`, bookmarkError);
                }
            }

            return { imageUrl, thumbnailUrl, imageId: imageRef.id };
        } catch (err) {
            logger.error("processAndUploadSingleImage failed", err);
            throw err;
        }
    });
}
