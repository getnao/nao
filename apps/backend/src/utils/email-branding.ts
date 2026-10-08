import {
	DEFAULT_APP_NAME,
	DEFAULT_BRAND_COLOR,
	getActiveBranding,
	getActiveBrandingAsset,
} from '../services/branding.service';
import type { EmailAttachment } from '../types/email';
import { EMAIL_LOGO_CID, emailLogoAttachment } from './email-logo';

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

export async function resolveEmailBranding(): Promise<EmailBranding> {
	const branding = await getActiveBranding();
	if (!branding) {
		return defaultEmailBranding;
	}
	return {
		appName: branding.appName?.trim() || DEFAULT_APP_NAME,
		brandColor: branding.brandColor ?? DEFAULT_BRAND_COLOR,
		logo: await resolveWhiteLabelLogo(),
		isWhiteLabel: true,
	};
}

async function resolveWhiteLabelLogo(): Promise<EmailAttachment | undefined> {
	const asset = await getActiveBrandingAsset('logo');
	if (!asset || !EMAIL_SAFE_LOGO_MEDIA_TYPES.has(asset.mediaType)) {
		return undefined;
	}
	return {
		filename: `logo.${asset.mediaType.split('/')[1]}`,
		content: Buffer.from(asset.data, 'base64'),
		contentType: asset.mediaType,
		cid: EMAIL_LOGO_CID,
	};
}
