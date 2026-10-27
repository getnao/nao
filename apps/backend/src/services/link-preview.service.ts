import { createHash } from 'node:crypto';

import { type Segment, splitCodeIntoSegments } from '@nao/shared/story-segments';

import type { BrandingSummary } from '../queries/branding.queries';
import * as linkPreviewQueries from '../queries/link-preview.queries';
import { getDisplaySettings } from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import { logger } from '../utils/logger';
import { getActiveBranding, getActiveBrandingAsset, resolveAppName } from './branding.service';
import { getCustomStoryThumbnail } from './custom-story-thumbnail';

export interface LinkPreview {
	title: string;
	description: string;
	siteName: string;
	imageUrl: string | null;
	hasLargeImage: boolean;
}

type LinkTarget = { kind: 'story'; storyId: string } | { kind: 'chat'; chatId: string };

interface PreviewContext {
	appName: string;
	origin: string;
	defaultImageUrl: string | null;
}

interface LinkRoute {
	pattern: RegExp;
	resolve: (params: string[]) => Promise<LinkTarget | null>;
}

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXCERPT_MAX_LENGTH = 160;
const UNDECODABLE_LOGO_TYPES = new Set(['image/x-icon', 'image/vnd.microsoft.icon']);
export const LINK_PREVIEW_ROUTE_PREFIX = '/api/link-preview';

const LINK_ROUTES: LinkRoute[] = [
	{
		pattern: /^\/stories\/shared\/([^/]+)$/,
		resolve: async ([shareId]) => toStoryTarget(await linkPreviewQueries.getSharedStoryStoryId(shareId)),
	},
	{
		pattern: /^\/stories\/standalone\/([^/]+)$/,
		resolve: async ([storyId]) => toStoryTarget(storyId),
	},
	{
		pattern: /^\/stories\/preview\/([^/]+)\/([^/]+)$/,
		resolve: async ([chatId, slug]) => toStoryTarget((await storyQueries.getStoryByChatAndSlug(chatId, slug))?.id),
	},
	{
		pattern: /^\/stories\/([^/]+)$/,
		resolve: async ([storyId]) => toStoryTarget(storyId),
	},
	{
		pattern: /^\/shared-chat\/([^/]+)$/,
		resolve: async ([shareId]) => toChatTarget(await linkPreviewQueries.getSharedChatChatId(shareId)),
	},
	{
		pattern: new RegExp(`^/(${UUID_PATTERN})$`, 'i'),
		resolve: async ([chatId]) => toChatTarget(chatId),
	},
];

/**
 * Previews are read by anonymous unfurlers (Slack, Teams, …). Story thumbnails can show data, so they are only
 * exposed when the owning project opted in; pages that are neither a story nor a chat get the generic preview.
 */
export async function resolveLinkPreview(pathname: string, origin: string): Promise<LinkPreview> {
	const branding = await loadBranding();
	const context: PreviewContext = {
		appName: resolveAppName(branding),
		origin,
		defaultImageUrl: defaultImageUrl(branding, origin),
	};
	try {
		const target = await resolveLinkTarget(pathname);
		const preview = target ? await buildTargetPreview(target, context) : null;
		return preview ?? buildDefaultPreview(context);
	} catch (error) {
		logger.warn(`Link preview lookup failed for ${pathname}: ${String(error)}`, { source: 'system' });
		return buildDefaultPreview(context);
	}
}

export async function getLinkPreviewStoryThumbnail(storyId: string): Promise<Buffer | null> {
	const story = await storyQueries.getStoryById(storyId);
	const projectId = story ? await storyQueries.getStoryProjectId(story.id) : null;
	if (!story || story.format !== 'custom' || story.archivedAt || !(await areThumbnailsEnabled(projectId))) {
		return null;
	}
	const thumbnail = await getCustomStoryThumbnail(story, 'light');
	return thumbnail?.image ?? null;
}

export async function getLinkPreviewLogo(): Promise<Buffer | null> {
	const logo = await getActiveBrandingAsset('logo');
	if (!logo || UNDECODABLE_LOGO_TYPES.has(logo.mediaType.toLowerCase())) {
		return null;
	}
	return Buffer.from(logo.data, 'base64');
}

export function extractStoryExcerpt(code: string): string | null {
	const text = collectMarkdown(splitCodeIntoSegments(code))
		.flatMap((markdown) => markdown.split('\n'))
		.filter(isProseLine)
		.map(stripMarkdownFormatting)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text ? truncateAtWord(text, EXCERPT_MAX_LENGTH) : null;
}

async function resolveLinkTarget(pathname: string): Promise<LinkTarget | null> {
	for (const route of LINK_ROUTES) {
		const match = route.pattern.exec(pathname);
		if (match) {
			return route.resolve(match.slice(1).map(decodeURIComponent));
		}
	}
	return null;
}

function buildTargetPreview(target: LinkTarget, context: PreviewContext): Promise<LinkPreview | null> {
	return target.kind === 'story'
		? buildStoryPreview(target.storyId, context)
		: buildChatPreview(target.chatId, context);
}

async function buildStoryPreview(storyId: string, context: PreviewContext): Promise<LinkPreview | null> {
	const story = await linkPreviewQueries.getStoryLinkPreview(storyId);
	if (!story) {
		return null;
	}
	const [excerpt, thumbnailUrl] = await Promise.all([
		story.format === 'classic' ? getStoryExcerpt(story.id) : null,
		story.format === 'custom' ? getStoryThumbnailUrl(story.id, story.projectId, context.origin) : null,
	]);
	const byline = story.ownerName ? `Story by ${story.ownerName}` : 'Story';
	return {
		title: story.title,
		description: [byline, excerpt].filter(Boolean).join(' · '),
		siteName: context.appName,
		imageUrl: thumbnailUrl ?? context.defaultImageUrl,
		hasLargeImage: thumbnailUrl !== null,
	};
}

async function buildChatPreview(chatId: string, context: PreviewContext): Promise<LinkPreview | null> {
	const chat = await linkPreviewQueries.getChatLinkPreview(chatId);
	if (!chat) {
		return null;
	}
	return {
		title: chat.title,
		description: `Chat by ${chat.ownerName}`,
		siteName: context.appName,
		imageUrl: context.defaultImageUrl,
		hasLargeImage: false,
	};
}

function buildDefaultPreview(context: PreviewContext): LinkPreview {
	return {
		title: `${context.appName} — Chat with your data`,
		description: `Use ${context.appName} to chat with your data warehouse, display charts and share stories`,
		siteName: context.appName,
		imageUrl: context.defaultImageUrl,
		hasLargeImage: false,
	};
}

async function getStoryExcerpt(storyId: string): Promise<string | null> {
	const version = await storyQueries.getLatestVersionByStoryId(storyId);
	return version ? extractStoryExcerpt(version.code) : null;
}

/** The version and render key are in the URL so unfurlers refetch the image once the story changes. */
async function getStoryThumbnailUrl(storyId: string, projectId: string | null, origin: string): Promise<string | null> {
	if (!(await areThumbnailsEnabled(projectId))) {
		return null;
	}
	const story = await storyQueries.getStoryById(storyId);
	const thumbnail = story ? await getCustomStoryThumbnail(story, 'light') : null;
	if (!thumbnail) {
		return null;
	}
	const version = createHash('sha256')
		.update(`${thumbnail.versionId}.${thumbnail.renderKey}`)
		.digest('base64url')
		.slice(0, 12);
	return `${origin}${LINK_PREVIEW_ROUTE_PREFIX}/stories/${encodeURIComponent(storyId)}/thumbnail.jpg?v=${version}`;
}

/** White-labeled apps never fall back to the nao icon: without a usable logo, previews carry no image. */
function defaultImageUrl(branding: BrandingSummary | null, origin: string): string | null {
	if (!branding) {
		return `${origin}/appicon.png`;
	}
	if (!branding.logo || UNDECODABLE_LOGO_TYPES.has(branding.logo.mediaType.toLowerCase())) {
		return null;
	}
	return `${origin}${LINK_PREVIEW_ROUTE_PREFIX}/logo.png?v=${branding.updatedAt.getTime()}`;
}

async function areThumbnailsEnabled(projectId: string | null): Promise<boolean> {
	if (!projectId) {
		return false;
	}
	const settings = await getDisplaySettings(projectId);
	return settings.linkPreviewThumbnails === true;
}

async function loadBranding(): Promise<BrandingSummary | null> {
	try {
		return await getActiveBranding();
	} catch (error) {
		logger.warn(`Branding lookup failed for link preview: ${String(error)}`, { source: 'system' });
		return null;
	}
}

function toStoryTarget(storyId: string | null | undefined): LinkTarget | null {
	return storyId ? { kind: 'story', storyId } : null;
}

function toChatTarget(chatId: string | null | undefined): LinkTarget | null {
	return chatId ? { kind: 'chat', chatId } : null;
}

function collectMarkdown(segments: Segment[]): string[] {
	return segments.flatMap((segment) => {
		if (segment.type === 'markdown') {
			return [segment.content];
		}
		return segment.type === 'grid' ? collectMarkdown(segment.children) : [];
	});
}

function isProseLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed !== '' && !/^(#{1,6}\s|\||```|~~~|[-*_]{3,}$)/.test(trimmed);
}

function stripMarkdownFormatting(line: string): string {
	return line
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
		.replace(/^\s*>\s?/, '')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<\/?[a-zA-Z][^>]*>/g, '')
		.replace(/(\*\*|__|~~|\*|_|`)(.+?)\1/g, '$2');
}

function truncateAtWord(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	const cut = text.slice(0, maxLength - 1);
	const lastSpace = cut.lastIndexOf(' ');
	return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
