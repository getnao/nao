/* @license Enterprise */

import { eq } from 'drizzle-orm';

import s, { DBBrandingConfig, NewBrandingConfig } from '../db/abstractSchema';
import { db } from '../db/db';

const SINGLETON_ID = 'default';

export type BrandingAssetKind = 'logo' | 'favicon';

export interface BrandingAsset {
	data: string;
	mediaType: string;
}

export interface BrandingSummary {
	appName: string | null;
	tabTitle: string | null;
	brandColor: string | null;
	logo: { mediaType: string } | null;
	favicon: { mediaType: string } | null;
	updatedAt: Date;
}

export interface BrandingUpdate {
	appName?: string | null;
	tabTitle?: string | null;
	brandColor?: string | null;
	logo?: BrandingAsset | null;
	favicon?: BrandingAsset | null;
}

const ASSET_COLUMNS: Record<BrandingAssetKind, { data: keyof DBBrandingConfig; mediaType: keyof DBBrandingConfig }> = {
	logo: { data: 'logoData', mediaType: 'logoMediaType' },
	favicon: { data: 'faviconData', mediaType: 'faviconMediaType' },
};

export async function getBrandingRow(): Promise<DBBrandingConfig | null> {
	const [row] = await db.select().from(s.brandingConfig).where(eq(s.brandingConfig.id, SINGLETON_ID)).execute();
	return row ?? null;
}

export async function getBrandingSummary(): Promise<BrandingSummary | null> {
	const row = await getBrandingRow();
	if (!row) {
		return null;
	}
	return {
		appName: row.appName ?? null,
		tabTitle: row.tabTitle ?? null,
		brandColor: row.brandColor ?? null,
		logo: row.logoMediaType ? { mediaType: row.logoMediaType } : null,
		favicon: row.faviconMediaType ? { mediaType: row.faviconMediaType } : null,
		updatedAt: row.updatedAt,
	};
}

export async function getBrandingAsset(kind: BrandingAssetKind): Promise<BrandingAsset | null> {
	const row = await getBrandingRow();
	if (!row) {
		return null;
	}
	const cols = ASSET_COLUMNS[kind];
	const data = row[cols.data] as string | null;
	const mediaType = row[cols.mediaType] as string | null;
	if (!data || !mediaType) {
		return null;
	}
	return { data, mediaType };
}

export async function upsertBranding(update: BrandingUpdate): Promise<void> {
	const partial: Partial<NewBrandingConfig> = {};

	if (update.appName !== undefined) {
		partial.appName = update.appName;
	}
	if (update.tabTitle !== undefined) {
		partial.tabTitle = update.tabTitle;
	}
	if (update.brandColor !== undefined) {
		partial.brandColor = update.brandColor;
	}
	if (update.logo !== undefined) {
		partial.logoData = update.logo?.data ?? null;
		partial.logoMediaType = update.logo?.mediaType ?? null;
	}
	if (update.favicon !== undefined) {
		partial.faviconData = update.favicon?.data ?? null;
		partial.faviconMediaType = update.favicon?.mediaType ?? null;
	}

	if (Object.keys(partial).length === 0) {
		return;
	}

	await db
		.insert(s.brandingConfig)
		.values({ id: SINGLETON_ID, ...partial })
		.onConflictDoUpdate({
			target: s.brandingConfig.id,
			set: { ...partial, updatedAt: new Date() },
		})
		.execute();
}

export async function clearBrandingAsset(kind: BrandingAssetKind): Promise<void> {
	const cols = ASSET_COLUMNS[kind];
	await db
		.update(s.brandingConfig)
		.set({ [cols.data]: null, [cols.mediaType]: null })
		.where(eq(s.brandingConfig.id, SINGLETON_ID))
		.execute();
}
