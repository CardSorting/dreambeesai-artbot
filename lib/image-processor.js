import sharp from 'sharp';

/**
 * Stitches 4 images into a 2x2 grid.
 */
/**
 * Stitches four images into a 2x2 grid.
 * @param {Buffer[]} buffers - Array of 4 image buffers.
 * @returns {Promise<Buffer>} The stitched image buffer.
 */
export async function stitchImages(buffers) {
    if (!buffers || buffers.length !== 4) throw new Error("Need exactly 4 buffers to stitch");
    const result = await sharp({
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

    return result;
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
 * Stitches two images side-by-side for comparison.
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

    return sharp({
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
}

export async function stitchNarrativeStrip(buffers) {
    if (buffers.length < 2) return buffers[0];
    
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

    return sharp({
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
}
