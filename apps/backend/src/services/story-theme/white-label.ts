import { HEX_COLOR, MAX_STORY_LOGO_BYTES, STORY_LOGO_MEDIA_TYPES } from '@nao/shared/story-theme';
import { SOURCE_IMAGE_MEDIA_TYPES } from '@nao/shared/story-theme-source';

import { logger } from '../../utils/logger';
import { DEFAULT_APP_NAME, DEFAULT_BRAND_COLOR, getActiveBranding, getActiveBrandingAsset } from '../branding.service';
import type { SourceImage } from './generate';

const SVG_RASTER_SIZE = 512;

export interface StoryLogo {
	dataUri: string;
	image: SourceImage | null;
}

export interface WhiteLabelBrand {
	appName: string | null;
	brandColor: string | null;
	logo: StoryLogo | null;
	skippedLogoNote: string | null;
}

export async function readWhiteLabelBrand(): Promise<WhiteLabelBrand | null> {
	try {
		const branding = await getActiveBranding();
		if (!branding) {
			return null;
		}
		const asset = branding.logo ? await getActiveBrandingAsset('logo') : null;
		const logo = asset ? await toStoryLogo(asset.data, asset.mediaType) : null;
		const brand: WhiteLabelBrand = {
			appName: customAppName(branding.appName),
			brandColor: customBrandColor(branding.brandColor),
			logo,
			skippedLogoNote: asset && !logo ? describeSkippedLogo(asset.mediaType) : null,
		};
		return brand.appName || brand.brandColor || brand.logo ? brand : null;
	} catch (error) {
		logger.warn(`White-label branding could not be read for theme generation: ${String(error)}`, {
			source: 'system',
		});
		return null;
	}
}

export function renderWhiteLabelBrand(brand: WhiteLabelBrand, { logoAttached }: { logoAttached: boolean }): string {
	return [
		'WHITE-LABEL BRANDING, set by the admin in nao’s white-label settings:',
		brand.appName ? `  Brand name: ${brand.appName}` : '',
		brand.brandColor
			? `  Primary colour: ${brand.brandColor} — the brand's own declared primary. Use it as the accent and the first chart colour unless the admin guidance says otherwise.`
			: '',
		logoAttached && brand.logo?.image
			? '  The logo is the last attached image: read the wordmark style and colours from it.'
			: '',
		brand.logo ? '  A logo is configured, so the story header shows it: prefer header "logo" or "band".' : '',
		brand.appName && !brand.logo ? '  A brand name is configured, so the story header can use header "name".' : '',
	]
		.filter(Boolean)
		.join('\n');
}

function customAppName(appName: string | null): string | null {
	const trimmed = appName?.trim();
	return trimmed && trimmed !== DEFAULT_APP_NAME ? trimmed : null;
}

function customBrandColor(brandColor: string | null): string | null {
	const trimmed = brandColor?.trim().toLowerCase();
	return trimmed && HEX_COLOR.test(trimmed) && trimmed !== DEFAULT_BRAND_COLOR ? trimmed : null;
}

export async function toStoryLogo(data: string, rawMediaType: string): Promise<StoryLogo | null> {
	const mediaType = normalizeMediaType(rawMediaType);
	const base64 = data.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
	const isStoryLogo = (STORY_LOGO_MEDIA_TYPES as readonly string[]).includes(mediaType);
	if (!isStoryLogo || Buffer.byteLength(base64, 'base64') > MAX_STORY_LOGO_BYTES) {
		return null;
	}
	const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
	const isRaster = (SOURCE_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType);
	return {
		dataUri: `data:${mediaType};base64,${base64}`,
		image: isRaster ? { data: bytes, mediaType } : await rasterizeSvg(bytes),
	};
}

function normalizeMediaType(rawMediaType: string): string {
	return rawMediaType.toLowerCase().replace('image/jpg', 'image/jpeg');
}

function describeSkippedLogo(rawMediaType: string): string {
	const isStoryLogo = (STORY_LOGO_MEDIA_TYPES as readonly string[]).includes(normalizeMediaType(rawMediaType));
	const reason = isStoryLogo
		? `it is larger than ${MAX_STORY_LOGO_BYTES / 1024} KB`
		: 'stories only show PNG, JPEG, WebP or SVG logos';
	return `The white-label logo was left out of the story header because ${reason}. Upload one in the Brand header card.`;
}

/** The model only reads raster images, so an SVG logo is drawn to a PNG for it; the header keeps the SVG. */
async function rasterizeSvg(svg: Uint8Array): Promise<SourceImage | null> {
	try {
		const { default: sharp } = await import('sharp');
		const png = await sharp(Buffer.from(svg))
			.resize(SVG_RASTER_SIZE, SVG_RASTER_SIZE, { fit: 'inside' })
			.png()
			.toBuffer();
		return { data: new Uint8Array(png), mediaType: 'image/png' };
	} catch (error) {
		logger.warn(`An SVG logo could not be rasterized for theme generation: ${String(error)}`, { source: 'system' });
		return null;
	}
}
