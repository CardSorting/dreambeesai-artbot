import sharp from 'sharp';
import pLimit from 'p-limit';
import { logger } from './logger.js';

// CONCURRENCY CONTROL: Prevent OOM on 2GB Cloud Run instances
const imageLimit = pLimit(process.env.IMAGE_CONCURRENCY || 4);

// MEMORY OPTIMIZATION: Disable internal sharp cache to ensure buffers are freed immediately after use.
sharp.cache(false);

/**
 * Pinnacle+ World-Class "Prism" Branding Pass.
 * Features frosted crystal grain, spectral prism refraction, and Royal Monogram detailing.
 */
const WATERMARK_SVG = Buffer.from(`
<svg width="450" height="70">
  <defs>
    <!-- Ultra-Luxe Glassmorphism Filter -->
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

  <!-- spectral refraction edge -->
  <rect x="145" y="10" width="300" height="42" rx="21" fill="url(#prismEdge)" />
  
  <!-- Elite Glass Capsule -->
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
  
  <!-- Royal Symmetrical Monogram Bee 2.0 -->
  <g transform="translate(170, 16) scale(0.65)" class="monogram">
     <path d="M10,20 Q20,5 30,20 Q20,35 10,20 Z" fill="white" fill-opacity="0.05" />
     <path d="M15,12 A10,10 0 0,1 25,12 M12,25 A12,8 0 0,0 28,25" />
     <circle cx="20" cy="20" r="1.5" fill="white" stroke="none" />
  </g>
  
  <text x="430" y="40" text-anchor="end" class="text">DREAMBEES AI</text>
</svg>
`);

/**
 * Applies a subtle watermark to the bottom-right of an image buffer.
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
 * Stitches 4 images into a 2x2 grid. No watermark applied as per user request.
 * @param {Buffer[]} buffers - Array of 4 image buffers.
 * @returns {Promise<Buffer>} The stitched image buffer.
 */
export async function stitchImages(buffers, options = {}) {
    return imageLimit(async () => {
        const { logger: ctxLogger = logger, signal } = options;
        if (!buffers || buffers.length !== 4) throw new Error("Need exactly 4 buffers to stitch");
        
        if (signal?.aborted) {
            ctxLogger.info("Stitching aborted by signal before start");
            return null;
        }
        
        try {
            const resized = await Promise.all(buffers.map(b => sharp(b).resize(1024, 1024).toBuffer()));
            
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
            
            // Help GC: Null out the intermediate resized buffers
            resized.length = 0;
            
            return result;
        } catch (err) {
            ctxLogger.error("Grid Stitching Failed", err);
            throw new Error("Failed to create image grid due to an internal processing error.");
        }
    });
}

/**
 * Validates that a buffer is a valid image.
 */
export async function validateImageBuffer(buffer, label) {
    try {
        await sharp(buffer).metadata();
    } catch (err) {
        logger.warn(`Invalid image buffer detected for ${label}`, { error: err.message });
        throw new Error(`Corrupt or invalid image buffer for ${label}: ${err.message}`);
    }
}

/**
 * Stitches two images side-by-side with refined watermark.
 * @param {Buffer} buffer1 - Original image.
 * @param {Buffer} buffer2 - Remixed image.
 * @returns {Promise<Buffer>}
 */
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
                create: {
                    width: totalWidth,
                    height: targetHeight,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 1 }
                }
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
