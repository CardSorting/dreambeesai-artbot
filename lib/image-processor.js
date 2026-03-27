import sharp from 'sharp';

/**
 * Pinnacle+ World-Class "Prism" Branding Pass.
 * Features frosted crystal grain, spectral prism refraction, and Royal Monogram detailing.
 */
const WATERMARK_SVG = Buffer.from(`
<svg width="450" height="60">
  <defs>
    <!-- Frosted Crystal Reflection Filter -->
    <filter id="crystalGrain" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" result="noise" />
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.1 0" />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>
    
    <!-- Prism Spectral Refraction -->
    <linearGradient id="prismEdge" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ff0000" stop-opacity="0.015" />
      <stop offset="50%" stop-color="#00ff00" stop-opacity="0.015" />
      <stop offset="100%" stop-color="#0000ff" stop-opacity="0.015" />
    </linearGradient>

    <linearGradient id="pinnaclePlusGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="white" stop-opacity="0.05" />
        <stop offset="50%" stop-color="white" stop-opacity="0.45" />
        <stop offset="100%" stop-color="white" stop-opacity="0.05" />
    </linearGradient>
  </defs>

  <!-- spectral refraction edge -->
  <rect x="148" y="11" width="294" height="38" rx="19" fill="url(#prismEdge)" />
  
  <!-- Frosted Glass Capsule Backdrop -->
  <rect x="150" y="12" width="290" height="36" rx="18" fill="white" fill-opacity="0.04" filter="url(#crystalGrain)" />
  
  <style>
    .text { 
        fill: url(#pinnaclePlusGrad); 
        font-family: Arial, sans-serif; 
        font-size: 15.2px; 
        font-weight: 500; 
        letter-spacing: 7.2px;
        text-transform: uppercase;
        filter: drop-shadow(0 0 1px rgba(255,255,255,0.25));
    }
    .monogram { 
        stroke: url(#pinnaclePlusGrad);
        stroke-width: 2.2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
  </style>
  
  <!-- Royal Symmetrical Monogram Bee -->
  <g transform="translate(172, 14) scale(0.68)" class="monogram">
     <circle cx="20" cy="20" r="15" opacity="0.05" fill="white" stroke="none" />
     <path d="M10,20 A10,12 0 1,1 30,20 A10,12 0 1,1 10,20 M14,12 A6,6 0 0,1 26,12" />
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
export async function stitchImages(buffers) {
    if (!buffers || buffers.length !== 4) throw new Error("Need exactly 4 buffers to stitch");
    return await sharp({
        create: { width: 2048, height: 2048, channels: 3, background: { r: 0, g: 0, b: 0 } }
    })
        .composite([
            { input: await sharp(buffers[0]).resize(1024, 1024).toBuffer(), top: 0, left: 0 },
            { input: await sharp(buffers[1]).resize(1024, 1024).toBuffer(), top: 0, left: 1024 },
            { input: await sharp(buffers[2]).resize(1024, 1024).toBuffer(), top: 1024, left: 0 },
            { input: await sharp(buffers[3]).resize(1024, 1024).toBuffer(), top: 1024, left: 1024 }
        ])
        .webp({ quality: 90 })
        .toBuffer();
}

/**
 * Validates that a buffer is a valid image.
 */
export async function validateImageBuffer(buffer, label) {
    try {
        await sharp(buffer).metadata();
    } catch (err) {
        throw new Error(`Corrupt or invalid image buffer for ${label}: ${err.message}`);
    }
}

/**
 * Stitches two images side-by-side with refined watermark.
 * @param {Buffer} buffer1 - Original image.
 * @param {Buffer} buffer2 - Remixed image.
 * @returns {Promise<Buffer>}
 */
export async function stitchSideBySide(buffer1, buffer2) {
    const img1 = sharp(buffer1);
    const img2 = sharp(buffer2);
    const meta1 = await img1.metadata();
    const meta2 = await img2.metadata();

    const targetHeight = Math.max(meta1.height, meta2.height);
    const targetWidth = Math.round(meta1.width * (targetHeight / meta1.height));
    const targetWidth2 = Math.round(meta2.width * (targetHeight / meta2.height));

    const resImg1 = await img1.resize({ height: targetHeight }).toBuffer();
    const resImg2 = await img2.resize({ height: targetHeight }).toBuffer();

    const stitched = await sharp({
        create: {
            width: targetWidth + targetWidth2,
            height: targetHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 }
        }
    })
    .composite([
        { input: resImg1, left: 0, top: 0 },
        { input: resImg2, left: targetWidth, top: 0 }
    ])
    .webp()
    .toBuffer();

    return applyWatermark(stitched);
}

export async function stitchNarrativeStrip(buffers) {
    if (buffers.length < 2) return applyWatermark(buffers[0]);
    
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
}
