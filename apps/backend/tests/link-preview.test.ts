import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getActiveBranding: vi.fn(),
	getActiveBrandingAsset: vi.fn(),
	getDisplaySettings: vi.fn(),
	getStoryLinkPreview: vi.fn(),
	getChatLinkPreview: vi.fn(),
	getSharedStoryStoryId: vi.fn(),
	getSharedChatChatId: vi.fn(),
	getStoryById: vi.fn(),
	getStoryProjectId: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getCustomStoryThumbnail: vi.fn(),
}));

vi.mock('../src/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../src/services/branding.service', () => ({
	getActiveBranding: mocks.getActiveBranding,
	getActiveBrandingAsset: mocks.getActiveBrandingAsset,
	resolveAppName: (branding: { appName: string | null } | null) => branding?.appName?.trim() || 'nao',
}));
vi.mock('../src/queries/project.queries', () => ({ getDisplaySettings: mocks.getDisplaySettings }));
vi.mock('../src/queries/link-preview.queries', () => ({
	getStoryLinkPreview: mocks.getStoryLinkPreview,
	getChatLinkPreview: mocks.getChatLinkPreview,
	getSharedStoryStoryId: mocks.getSharedStoryStoryId,
	getSharedChatChatId: mocks.getSharedChatChatId,
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryById: mocks.getStoryById,
	getStoryProjectId: mocks.getStoryProjectId,
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
}));
vi.mock('../src/services/custom-story-thumbnail', () => ({
	getCustomStoryThumbnail: mocks.getCustomStoryThumbnail,
}));

import {
	extractStoryExcerpt,
	getLinkPreviewStoryThumbnail,
	resolveLinkPreview,
} from '../src/services/link-preview.service';
import { injectLinkPreview } from '../src/utils/app-shell';

const ORIGIN = 'https://moon.getnao.io';
const CHAT_ID = '0b8e6c1e-4d0f-4c4e-9a7b-2f1d3c5e6a7b';

const classicStory = {
	id: 'story-1',
	title: 'nao Cloud KPIs',
	format: 'classic',
	projectId: 'project-1',
	ownerName: 'Claire',
};

describe('resolveLinkPreview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getActiveBranding.mockResolvedValue(null);
		mocks.getDisplaySettings.mockResolvedValue({ linkPreviewThumbnails: true });
	});

	it('describes a story with its owner and an excerpt of its text', async () => {
		mocks.getStoryLinkPreview.mockResolvedValue(classicStory);
		mocks.getLatestVersionByStoryId.mockResolvedValue({ code: '# KPIs\n\nSignups are **up 12%** this week.' });

		const preview = await resolveLinkPreview('/stories/story-1', ORIGIN);

		expect(preview).toEqual({
			title: 'nao Cloud KPIs',
			description: 'Story by Claire · Signups are up 12% this week.',
			siteName: 'nao',
			imageUrl: `${ORIGIN}/appicon.png`,
			hasLargeImage: false,
		});
	});

	it('uses the rendered thumbnail of a custom story as a large image', async () => {
		mocks.getStoryLinkPreview.mockResolvedValue({ ...classicStory, format: 'custom' });
		mocks.getStoryById.mockResolvedValue({ id: 'story-1', isLive: false });
		mocks.getCustomStoryThumbnail.mockResolvedValue({ versionId: 'v1', renderKey: 'key', image: Buffer.from('') });

		const preview = await resolveLinkPreview('/stories/story-1', ORIGIN);

		expect(preview.description).toBe('Story by Claire');
		expect(preview.hasLargeImage).toBe(true);
		expect(preview.imageUrl).toMatch(
			new RegExp(`^${ORIGIN}/api/link-preview/stories/story-1/thumbnail\\.jpg\\?v=[\\w-]{12}$`),
		);
	});

	it('resolves shared story links to their story', async () => {
		mocks.getSharedStoryStoryId.mockResolvedValue('story-1');
		mocks.getStoryLinkPreview.mockResolvedValue(classicStory);
		mocks.getLatestVersionByStoryId.mockResolvedValue({ code: '' });

		const preview = await resolveLinkPreview('/stories/shared/share-1', ORIGIN);

		expect(mocks.getStoryLinkPreview).toHaveBeenCalledWith('story-1');
		expect(preview.title).toBe('nao Cloud KPIs');
	});

	it('describes a chat with its creator', async () => {
		mocks.getChatLinkPreview.mockResolvedValue({
			title: 'Weekly churn',
			projectId: 'project-1',
			ownerName: 'Claire',
		});

		const preview = await resolveLinkPreview(`/${CHAT_ID}`, ORIGIN);

		expect(mocks.getChatLinkPreview).toHaveBeenCalledWith(CHAT_ID);
		expect(preview).toMatchObject({ title: 'Weekly churn', description: 'Chat by Claire' });
	});

	it('only drops the thumbnail when the project did not opt in', async () => {
		mocks.getDisplaySettings.mockResolvedValue({ linkPreviewThumbnails: false });
		mocks.getStoryLinkPreview.mockResolvedValue({ ...classicStory, format: 'custom' });

		const preview = await resolveLinkPreview('/stories/story-1', ORIGIN);

		expect(preview).toEqual({
			title: 'nao Cloud KPIs',
			description: 'Story by Claire',
			siteName: 'nao',
			imageUrl: `${ORIGIN}/appicon.png`,
			hasLargeImage: false,
		});
		expect(mocks.getCustomStoryThumbnail).not.toHaveBeenCalled();
	});

	it('does not serve the thumbnail image when the project did not opt in', async () => {
		mocks.getDisplaySettings.mockResolvedValue({ linkPreviewThumbnails: false });
		mocks.getStoryById.mockResolvedValue({ id: 'story-1', format: 'custom', archivedAt: null });
		mocks.getStoryProjectId.mockResolvedValue('project-1');

		expect(await getLinkPreviewStoryThumbnail('story-1')).toBeNull();
		expect(mocks.getCustomStoryThumbnail).not.toHaveBeenCalled();
	});

	it('keeps the generic preview for other pages', async () => {
		const preview = await resolveLinkPreview('/settings/appearance', ORIGIN);

		expect(preview.title).toBe('nao — Chat with your data');
		expect(mocks.getChatLinkPreview).not.toHaveBeenCalled();
	});

	it('uses the white-label name and logo instead of nao', async () => {
		mocks.getActiveBranding.mockResolvedValue({
			appName: 'Fibi',
			logo: { mediaType: 'image/svg+xml' },
			updatedAt: new Date(1_700_000_000_000),
		});

		const preview = await resolveLinkPreview('/', ORIGIN);

		expect(preview).toMatchObject({
			title: 'Fibi — Chat with your data',
			description: 'Use Fibi to chat with your data warehouse, display charts and share stories',
			siteName: 'Fibi',
			imageUrl: `${ORIGIN}/api/link-preview/logo.png?v=1700000000000`,
		});
	});

	it('never shows the nao icon on a white-labeled app without a logo', async () => {
		mocks.getActiveBranding.mockResolvedValue({ appName: 'Fibi', logo: null, updatedAt: new Date() });

		const preview = await resolveLinkPreview('/', ORIGIN);

		expect(preview.imageUrl).toBeNull();
	});
});

describe('extractStoryExcerpt', () => {
	it('keeps prose and drops headings, blocks and tables', () => {
		const code = [
			'# Weekly report',
			'<chart query_id="q1" chart_type="bar" x_axis_key="day" />',
			'- Revenue is [on track](https://example.com)',
			'| a | b |',
			'<grid cols="2"><table query_id="q2" /></grid>',
			'> Watch the _churn_ closely',
		].join('\n');

		expect(extractStoryExcerpt(code)).toBe('Revenue is on track Watch the churn closely');
	});

	it('truncates long text on a word boundary', () => {
		const excerpt = extractStoryExcerpt('word '.repeat(100));

		expect(excerpt?.length).toBeLessThanOrEqual(160);
		expect(excerpt).toMatch(/word…$/);
	});

	it('returns null when the story has no prose', () => {
		expect(extractStoryExcerpt('## Only a heading')).toBeNull();
	});
});

describe('injectLinkPreview', () => {
	const html = [
		'<head>',
		'\t\t<meta name="description" content="old" />',
		'\t\t<meta property="og:title" content="old" />',
		'\t\t<meta',
		'\t\t\tproperty="og:description"',
		'\t\t\tcontent="old"',
		'\t\t/>',
		'\t\t<title>old</title>',
		'\t</head>',
	].join('\n');

	it('replaces the static tags and escapes the values', () => {
		const result = injectLinkPreview(html, {
			title: 'Sales <Q3> & "more"',
			description: 'Story by Claire',
			siteName: 'nao',
			imageUrl: 'https://moon.getnao.io/appicon.png',
			hasLargeImage: false,
		});

		expect(result).not.toContain('old');
		expect(result).toContain('<title>Sales &lt;Q3&gt; &amp; &quot;more&quot;</title>');
		expect(result).toContain('<meta property="og:image" content="https://moon.getnao.io/appicon.png" />');
		expect(result).toContain('<meta name="twitter:card" content="summary" />');
	});

	it('omits image tags when there is no image', () => {
		const result = injectLinkPreview(html, {
			title: 'Fibi',
			description: 'Fibi',
			siteName: 'Fibi',
			imageUrl: null,
			hasLargeImage: false,
		});

		expect(result).not.toContain('og:image');
	});
});
