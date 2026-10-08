import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getActiveBranding: vi.fn(),
	getActiveBrandingAsset: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: { BETTER_AUTH_URL: 'https://app.example' } }));
vi.mock('../src/services/branding.service', () => ({
	DEFAULT_APP_NAME: 'nao',
	DEFAULT_BRAND_COLOR: '#522bff',
	getActiveBranding: mocks.getActiveBranding,
	getActiveBrandingAsset: mocks.getActiveBrandingAsset,
	resolveAppName: (branding: { appName: string | null } | null) => branding?.appName?.trim() || 'nao',
}));

import { resolveEmailBranding } from '../src/utils/email-branding';
import { buildNotificationEmail, buildUserAddedEmail } from '../src/utils/email-builders';

const whiteLabel = {
	appName: 'Fibi',
	tabTitle: null,
	brandColor: '#ff6600',
	logo: { mediaType: 'image/png' },
	favicon: null,
	updatedAt: new Date('2026-10-08T00:00:00.000Z'),
};

const stripReactComments = (html: string): string => html.replace(/<!-- -->/g, '');

const pngLogo = { data: Buffer.from('png-bytes').toString('base64'), mediaType: 'image/png' };

describe('resolveEmailBranding', () => {
	beforeEach(() => {
		mocks.getActiveBranding.mockReset();
		mocks.getActiveBrandingAsset.mockReset();
	});

	it('falls back to nao defaults when white-labeling is off', async () => {
		mocks.getActiveBranding.mockResolvedValue(null);

		const branding = await resolveEmailBranding();

		expect(branding).toMatchObject({ appName: 'nao', brandColor: '#522bff', isWhiteLabel: false });
		expect(mocks.getActiveBrandingAsset).not.toHaveBeenCalled();
	});

	it('uses the configured name, color and raster logo', async () => {
		mocks.getActiveBranding.mockResolvedValue(whiteLabel);
		mocks.getActiveBrandingAsset.mockResolvedValue(pngLogo);

		const branding = await resolveEmailBranding();

		expect(branding).toMatchObject({ appName: 'Fibi', brandColor: '#ff6600', isWhiteLabel: true });
		expect(branding.logo).toMatchObject({ contentType: 'image/png', cid: 'nao-logo' });
		expect(branding.logo?.content).toEqual(Buffer.from('png-bytes'));
	});

	it('drops SVG logos that email clients cannot render', async () => {
		mocks.getActiveBranding.mockResolvedValue(whiteLabel);
		mocks.getActiveBrandingAsset.mockResolvedValue({ data: 'PHN2Zy8+', mediaType: 'image/svg+xml' });

		const branding = await resolveEmailBranding();

		expect(branding.logo).toBeUndefined();
	});

	it('falls back to defaults for missing name and color', async () => {
		mocks.getActiveBranding.mockResolvedValue({ ...whiteLabel, appName: '  ', brandColor: null, logo: null });
		mocks.getActiveBrandingAsset.mockResolvedValue(null);

		const branding = await resolveEmailBranding();

		expect(branding).toMatchObject({ appName: 'nao', brandColor: '#522bff', isWhiteLabel: true, logo: undefined });
	});
});

describe('white-labeled emails', () => {
	beforeEach(() => {
		mocks.getActiveBranding.mockReset().mockResolvedValue(whiteLabel);
		mocks.getActiveBrandingAsset.mockReset().mockResolvedValue(pngLogo);
	});

	it('brands the notification email subject, button and logo', async () => {
		const email = await buildNotificationEmail({ name: 'Ana' }, 'Weekly report', 'Body', 'https://app.example/x');

		expect(email.subject).toBe('Weekly report — Fibi');
		expect(email.html).toContain('Open in Fibi');
		expect(email.html).toContain('background-color:#ff6600');
		expect(email.html).toContain('src="cid:nao-logo"');
		expect(stripReactComments(email.html)).toContain('This is an automated message from Fibi.');
		expect(email.html).not.toContain('getnao.io');
		expect(email.attachments?.[0]).toMatchObject({ contentType: 'image/png', cid: 'nao-logo' });
	});

	it('brands the welcome email copy', async () => {
		const email = await buildUserAddedEmail({ name: 'Ana', email: 'ana@example.com' }, 'Acme', 'project', 'tmp-pw');

		expect(email.subject).toBe("You've been added to Acme on Fibi");
		expect(email.html).toContain('Log in to Fibi');
		expect(stripReactComments(email.html)).toContain('on Fibi.');
		expect(stripReactComments(email.html)).not.toContain('on nao');
	});

	it('keeps the nao footer when white-labeling is off', async () => {
		mocks.getActiveBranding.mockResolvedValue(null);

		const email = await buildNotificationEmail({ name: 'Ana' }, 'Weekly report', 'Body', 'https://app.example/x');

		expect(email.subject).toBe('Weekly report — nao');
		expect(email.html).toContain('getnao.io');
		expect(email.html).toContain('background-color:#522bff');
	});
});
