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
import { logger } from '../utils/logger';
import { hasFeature } from './license.service';

const WHITE_LABEL_FEATURE = LICENSE_FEATURES.whiteLabel;

export const DEFAULT_APP_NAME = 'nao';
export const DEFAULT_BRAND_COLOR = '#522bff';

/**
 * Messaging providers resolve the app name on every streamed card edit and bulk
 * emails resolve the logo per recipient, so lookups are memoised briefly. Writes
 * through this service invalidate them; other instances pick up changes once the
 * TTL elapses.
 */
const BRANDING_CACHE_TTL_MS = 60_000;

type CacheEntry<T> = { promise: Promise<T>; expiresAt: number };

let cachedSummary: CacheEntry<BrandingSummary | null> | null = null;
const cachedAssets = new Map<BrandingAssetKind, CacheEntry<BrandingAsset | null>>();

export async function isWhiteLabelEnabled(): Promise<boolean> {
	return hasFeature(WHITE_LABEL_FEATURE);
}

export function resolveAppName(branding: Pick<BrandingSummary, 'appName'> | null): string {
	return branding?.appName?.trim() || DEFAULT_APP_NAME;
}

/** Never throws: a failed branding lookup must not block a message or an email. */
export async function getAppName(): Promise<string> {
	try {
		return resolveAppName(await getActiveBranding());
	} catch (error) {
		logger.warn(`Branding lookup failed, falling back to "${DEFAULT_APP_NAME}": ${String(error)}`, {
			source: 'system',
		});
		return DEFAULT_APP_NAME;
	}
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
	return getCachedBrandingSummary();
}

export async function getActiveBrandingAsset(kind: BrandingAssetKind): Promise<BrandingAsset | null> {
	if (!(await isWhiteLabelEnabled())) {
		return null;
	}
	return getCachedBrandingAsset(kind);
}

export async function updateBranding(update: BrandingUpdate): Promise<void> {
	await upsertBranding(update);
	invalidateBrandingCache();
}

export async function removeBrandingAsset(kind: BrandingAssetKind): Promise<void> {
	await clearBrandingAsset(kind);
	invalidateBrandingCache();
}

export function invalidateBrandingCache(): void {
	cachedSummary = null;
	cachedAssets.clear();
}

function getCachedBrandingSummary(): Promise<BrandingSummary | null> {
	if (cachedSummary && cachedSummary.expiresAt > Date.now()) {
		return cachedSummary.promise;
	}
	cachedSummary = createCacheEntry(getBrandingSummary(), () => {
		cachedSummary = null;
	});
	return cachedSummary.promise;
}

function getCachedBrandingAsset(kind: BrandingAssetKind): Promise<BrandingAsset | null> {
	const cached = cachedAssets.get(kind);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.promise;
	}
	const entry = createCacheEntry(getBrandingAsset(kind), () => {
		cachedAssets.delete(kind);
	});
	cachedAssets.set(kind, entry);
	return entry.promise;
}

/** Failed lookups are evicted immediately so a transient error is not served for the whole TTL. */
function createCacheEntry<T>(lookup: Promise<T>, evict: () => void): CacheEntry<T> {
	const promise = lookup.catch((error: unknown) => {
		evict();
		throw error;
	});
	return { promise, expiresAt: Date.now() + BRANDING_CACHE_TTL_MS };
}
