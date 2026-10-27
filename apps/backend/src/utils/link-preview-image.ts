const BACKGROUND = '#ffffff';
const LOGO_CANVAS_SIZE = 512;
const LOGO_PADDING = 64;
const THUMBNAIL_QUALITY = 85;

/** Unfurlers do not all decode WebP, so story thumbnails are served as JPEG. */
export async function toPreviewThumbnail(image: Buffer): Promise<Buffer> {
	const sharp = await loadSharp();
	return sharp(image).flatten({ background: BACKGROUND }).jpeg({ quality: THUMBNAIL_QUALITY }).toBuffer();
}

/** Centres the logo on a square canvas so wide wordmarks are not cropped by square thumbnail slots. */
export async function toPreviewLogo(logo: Buffer): Promise<Buffer> {
	const sharp = await loadSharp();
	const innerSize = LOGO_CANVAS_SIZE - LOGO_PADDING * 2;
	return sharp(logo)
		.resize(innerSize, innerSize, { fit: 'contain', background: BACKGROUND })
		.extend({
			top: LOGO_PADDING,
			bottom: LOGO_PADDING,
			left: LOGO_PADDING,
			right: LOGO_PADDING,
			background: BACKGROUND,
		})
		.flatten({ background: BACKGROUND })
		.png()
		.toBuffer();
}

/** sharp is a native addon shipped next to the standalone binary, so it is loaded on first use. */
async function loadSharp() {
	const { default: sharp } = await import('sharp');
	return sharp;
}
