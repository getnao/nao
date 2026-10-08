import {
	DEFAULT_APP_NAME,
	DEFAULT_BRAND_COLOR,
	getActiveBranding,
	getActiveBrandingAsset,
	resolveAppName,
} from '../services/branding.service';
import type { EmailAttachment } from '../types/email';
import { EMAIL_LOGO_CID, emailLogoAttachment } from './email-logo';
import { logger } from './logger';

export interface EmailBranding {
	appName: string;
	brandColor: string;
	logo: EmailAttachment | undefined;
	isWhiteLabel: boolean;
}

export const defaultEmailBranding: EmailBranding = {
	appName: DEFAULT_APP_NAME,
	brandColor: DEFAULT_BRAND_COLOR,
	logo: emailLogoAttachment,
	isWhiteLabel: false,
};

/** Email clients do not reliably render SVG or ICO, so only raster logos are embedded. */
const EMAIL_SAFE_LOGO_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Never throws: a failed branding lookup must not block an email. */
export async function resolveEmailBranding(): Promise<EmailBranding> {
	try {
		const branding = await getActiveBranding();
		if (!branding) {
			return defaultEmailBranding;
		}
		return {
			appName: resolveAppName(branding),
			brandColor: branding.brandColor ?? DEFAULT_BRAND_COLOR,
			logo: await resolveWhiteLabelLogo(),
			isWhiteLabel: true,
		};
	} catch (error) {
		logger.warn(`Email branding lookup failed, falling back to defaults: ${String(error)}`, { source: 'system' });
		return defaultEmailBranding;
	}
}

async function resolveWhiteLabelLogo(): Promise<EmailAttachment | undefined> {
	const asset = await getActiveBrandingAsset('logo');
	const mediaType = asset?.mediaType.trim().toLowerCase();
	if (!asset || !mediaType || !EMAIL_SAFE_LOGO_MEDIA_TYPES.has(mediaType)) {
		return undefined;
	}
	return {
		filename: `logo.${mediaType.split('/')[1]}`,
		content: Buffer.from(asset.data, 'base64'),
		contentType: mediaType,
		cid: EMAIL_LOGO_CID,
	};
}
