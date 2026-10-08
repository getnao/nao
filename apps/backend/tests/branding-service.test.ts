import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getBrandingSummary: vi.fn(),
	getBrandingAsset: vi.fn(),
	upsertBranding: vi.fn(),
	clearBrandingAsset: vi.fn(),
	hasFeature: vi.fn(),
	warn: vi.fn(),
}));

vi.mock('../src/queries/branding.queries', () => ({
	getBrandingSummary: mocks.getBrandingSummary,
	getBrandingAsset: mocks.getBrandingAsset,
	upsertBranding: mocks.upsertBranding,
	clearBrandingAsset: mocks.clearBrandingAsset,
}));
vi.mock('../src/services/license.service', () => ({ hasFeature: mocks.hasFeature }));
vi.mock('../src/utils/logger', () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() } }));

import {
	getActiveBrandingAsset,
	getAppName,
	invalidateBrandingCache,
	removeBrandingAsset,
	resolveAppName,
	updateBranding,
} from '../src/services/branding.service';

const summary = (appName: string | null) => ({
	appName,
	tabTitle: null,
	brandColor: null,
	logo: null,
	favicon: null,
	updatedAt: new Date('2026-10-08T00:00:00.000Z'),
});

describe('branding service', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
		invalidateBrandingCache();
		mocks.getBrandingSummary.mockReset();
		mocks.getBrandingAsset.mockReset();
		mocks.upsertBranding.mockReset().mockResolvedValue(undefined);
		mocks.clearBrandingAsset.mockReset().mockResolvedValue(undefined);
		mocks.hasFeature.mockReset().mockResolvedValue(true);
		mocks.warn.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('falls back to nao for null, empty and whitespace names', () => {
		expect(resolveAppName(null)).toBe('nao');
		expect(resolveAppName(summary(null))).toBe('nao');
		expect(resolveAppName(summary(''))).toBe('nao');
		expect(resolveAppName(summary('   '))).toBe('nao');
		expect(resolveAppName(summary('  Fibi '))).toBe('Fibi');
	});

	it('returns nao when white-labeling is not licensed', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getBrandingSummary.mockResolvedValue(summary('Fibi'));

		await expect(getAppName()).resolves.toBe('nao');
		expect(mocks.getBrandingSummary).not.toHaveBeenCalled();
	});

	it('memoises the branding row across repeated lookups', async () => {
		mocks.getBrandingSummary.mockResolvedValue(summary('Fibi'));

		await expect(Promise.all([getAppName(), getAppName(), getAppName()])).resolves.toEqual([
			'Fibi',
			'Fibi',
			'Fibi',
		]);
		expect(mocks.getBrandingSummary).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(60_001);
		await getAppName();
		expect(mocks.getBrandingSummary).toHaveBeenCalledTimes(2);
	});

	it('invalidates the cache when branding is updated', async () => {
		mocks.getBrandingSummary.mockResolvedValueOnce(summary('Fibi')).mockResolvedValueOnce(summary('Zed'));

		await expect(getAppName()).resolves.toBe('Fibi');
		await updateBranding({ appName: 'Zed' });
		await expect(getAppName()).resolves.toBe('Zed');
	});

	it('memoises assets per kind and invalidates them on removal', async () => {
		const logo = { data: 'bG9nbw==', mediaType: 'image/png' };
		mocks.getBrandingAsset.mockResolvedValue(logo);

		await expect(Promise.all([getActiveBrandingAsset('logo'), getActiveBrandingAsset('logo')])).resolves.toEqual([
			logo,
			logo,
		]);
		await getActiveBrandingAsset('favicon');
		expect(mocks.getBrandingAsset).toHaveBeenCalledTimes(2);

		await removeBrandingAsset('logo');
		mocks.getBrandingAsset.mockResolvedValue(null);
		await expect(getActiveBrandingAsset('logo')).resolves.toBeNull();
		expect(mocks.getBrandingAsset).toHaveBeenCalledTimes(3);
	});

	it('does not cache failed lookups and falls back to nao', async () => {
		mocks.getBrandingSummary.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(summary('Fibi'));

		await expect(getAppName()).resolves.toBe('nao');
		expect(mocks.warn).toHaveBeenCalledTimes(1);
		await expect(getAppName()).resolves.toBe('Fibi');
	});
});
