import { HEX_COLOR, MAX_STORY_LOGO_BYTES, STORY_LOGO_MEDIA_TYPES } from '@nao/shared/story-theme';
import { SOURCE_IMAGE_MEDIA_TYPES } from '@nao/shared/story-theme-source';

import { logger } from '../../utils/logger';
import { DEFAULT_APP_NAME, DEFAULT_BRAND_COLOR, getActiveBranding, getActiveBrandingAsset } from '../branding.service';
import type { SourceImage } from './generate';

export interface StoryLogo {
	dataUri: string;
	image: SourceImage | null;
}

export interface WhiteLabelBrand {
	appName: string | null;
	brandColor: string | null;
	logo: StoryLogo | null;
}

export async function readWhiteLabelBrand(): Promise<WhiteLabelBrand | null> {
	try {
		const branding = await getActiveBranding();
		if (!branding) {
			return null;
		}
		const logo = branding.logo ? await getActiveBrandingAsset('logo') : null;
		const brand: WhiteLabelBrand = {
			appName: customAppName(branding.appName),
			brandColor: customBrandColor(branding.brandColor),
			logo: logo ? toStoryLogo(logo.data, logo.mediaType) : null,
		};
		return brand.appName || brand.brandColor || brand.logo ? brand : null;
	} catch (error) {
		logger.warn(`White-label branding could not be read for theme generation: ${String(error)}`, {
			source: 'system',
		});
		return null;
	}
}

export function renderWhiteLabelBrand(brand: WhiteLabelBrand): string {
	return [
		'WHITE-LABEL BRANDING, set by the admin in nao’s white-label settings:',
		brand.appName ? `  Brand name: ${brand.appName}` : '',
		brand.brandColor
			? `  Primary colour: ${brand.brandColor} — the brand's own declared primary. Use it as the accent and the first chart colour unless the admin guidance says otherwise.`
			: '',
		brand.logo?.image ? '  The logo is the last attached image: read the wordmark style and colours from it.' : '',
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

export function toStoryLogo(data: string, rawMediaType: string): StoryLogo | null {
	const mediaType = rawMediaType.toLowerCase().replace('image/jpg', 'image/jpeg');
	const base64 = data.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
	const isStoryLogo = (STORY_LOGO_MEDIA_TYPES as readonly string[]).includes(mediaType);
	if (!isStoryLogo || Buffer.byteLength(base64, 'base64') > MAX_STORY_LOGO_BYTES) {
		return null;
	}
	const isRaster = (SOURCE_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType);
	return {
		dataUri: `data:${mediaType};base64,${base64}`,
		image: isRaster ? { data: new Uint8Array(Buffer.from(base64, 'base64')), mediaType } : null,
	};
}
