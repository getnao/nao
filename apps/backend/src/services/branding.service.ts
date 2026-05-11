/* @license Enterprise */

import {
	BrandingAsset,
	BrandingAssetKind,
	BrandingSummary,
	BrandingUpdate,
	clearBrandingAsset,
	getBrandingAsset,
	getBrandingSummary,
	upsertBranding,
} from '../queries/branding.queries';
import { LICENSE_FEATURES } from '../types/license';
import { hasFeature } from './license.service';

const WHITE_LABEL_FEATURE = LICENSE_FEATURES.whiteLabel;

export async function isWhiteLabelEnabled(): Promise<boolean> {
	return hasFeature(WHITE_LABEL_FEATURE);
}

/**
 * Branding visible to the world: returned to anonymous visitors of the login
 * page, and to logged-in users for the sidebar and document title. Gated behind
 * the white-label feature flag so a stale `branding_config` row from a once-
 * licensed install does not keep skinning the app after the license lapses.
 */
export async function getActiveBranding(): Promise<BrandingSummary | null> {
	if (!(await isWhiteLabelEnabled())) {
		return null;
	}
	return getBrandingSummary();
}

export async function getActiveBrandingAsset(kind: BrandingAssetKind): Promise<BrandingAsset | null> {
	if (!(await isWhiteLabelEnabled())) {
		return null;
	}
	return getBrandingAsset(kind);
}

export async function updateBranding(update: BrandingUpdate): Promise<void> {
	await upsertBranding(update);
}

export async function removeBrandingAsset(kind: BrandingAssetKind): Promise<void> {
	await clearBrandingAsset(kind);
}
