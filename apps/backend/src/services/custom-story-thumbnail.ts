import type { StoryQueryResult } from '@nao/shared/story-app';
import { STORY_THEME_MODES, type StoryThemeMode } from '@nao/shared/story-theme';

import type { DBStory } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import { logger } from '../utils/logger';
import { isBrokenRender, renderStoryScreenshot } from '../utils/story-screenshot';
import { storyThemeFingerprint } from '../utils/story-theme-fingerprint';
import {
	type CustomStoryVersionView,
	getActiveThemeForStory,
	getLatestCustomStoryVersionByStoryId,
	getStoredCustomStoryQueryDataByStoryId,
} from './custom-story';
import { buildCustomStoryDocumentByStoryId } from './custom-story-export';

const THUMBNAIL_VIEWPORT = { width: 1280, height: 800 };
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_QUALITY = 80;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const MAX_BROKEN_RENDERS = 3;
/** Stored in place of a mode's image when the version has no app or that mode kept rendering broken: never retried. */
const UNRENDERABLE = '';

/** Base64 WebP per theme mode; a mode not rendered yet is absent. */
type ModeThumbnails = Partial<Record<StoryThemeMode, string>>;

const queuedVersionIds = new Set<string>();
const failuresByVersionId = new Map<string, { brokenRenders: number; failedAt: number }>();
let renderQueue: Promise<void> = Promise.resolve();

class MissingStoryDataError extends Error {}

class BrokenRenderError extends Error {
	constructor(
		readonly modes: StoryThemeMode[],
		readonly theme: string,
	) {
		super(`Broken render in ${modes.join(', ')} mode.`);
	}
}

export interface CustomStoryThumbnail {
	versionId: string;
	versionNumber: number;
	theme: string;
	isCurrent: boolean;
	image: Buffer;
}

/** Reads the latest version's WebP thumbnail without waiting on a render, queueing stale or missing images in the background. */
export async function getCustomStoryThumbnail(
	story: DBStory,
	mode: StoryThemeMode = 'light',
): Promise<CustomStoryThumbnail | null> {
	const version = await storyQueries.getLatestVersionByStoryId(story.id);
	if (!version) {
		return null;
	}
	const stored = await storyFileQueries.getVersionThumbnail(version.id);
	const images = parseThumbnails(stored?.thumbnail);
	const currentTheme = storyThemeFingerprint(await getActiveThemeForStory(story.id));
	const isCurrent = stored?.theme === currentTheme && STORY_THEME_MODES.every((each) => images[each] !== undefined);
	if (!isCurrent) {
		queueCustomStoryThumbnail(story.id, version.id);
	}
	const image = images[mode];
	if (!stored?.theme || !image) {
		return null;
	}
	return {
		versionId: version.id,
		versionNumber: version.version,
		theme: stored.theme,
		isCurrent,
		image: Buffer.from(image, 'base64'),
	};
}

/** Renders thumbnails in the background one at a time so they do not compete with viewers. */
export function queueCustomStoryThumbnail(storyId: string, versionId: string): void {
	if (queuedVersionIds.has(versionId) || isCoolingDown(versionId)) {
		return;
	}
	queuedVersionIds.add(versionId);
	renderQueue = renderQueue
		.then(() => renderAndRecord(storyId, versionId))
		.finally(() => queuedVersionIds.delete(versionId));
}

async function renderAndRecord(storyId: string, versionId: string): Promise<void> {
	try {
		await renderThumbnails(storyId, versionId);
		failuresByVersionId.delete(versionId);
	} catch (error) {
		await recordFailure(versionId, error).catch((recordError) => logFailure(versionId, recordError));
	}
}

/**
 * Renders, from saved results only, each mode still missing for the current theme. A clean mode is saved even when
 * the other one breaks, so a story broken only in dark mode keeps its light thumbnail; when nothing rendered, the
 * images of the previous theme stay served.
 */
async function renderThumbnails(storyId: string, versionId: string): Promise<void> {
	const version = await getLatestCustomStoryVersionByStoryId(storyId);
	if (version.version.id !== versionId) {
		return;
	}
	const theme = storyThemeFingerprint(version.theme);
	if (!version.app) {
		await saveThumbnails(versionId, { light: UNRENDERABLE, dark: UNRENDERABLE }, theme);
		return;
	}
	const queryData = await getStoredCustomStoryQueryDataByStoryId(storyId, version.queryIds);
	if (Object.keys(queryData).length < version.queryIds.length) {
		throw new MissingStoryDataError('Some queries have no saved result yet.');
	}

	const images = await loadThumbnailsForTheme(versionId, theme);
	const brokenModes: StoryThemeMode[] = [];
	for (const mode of STORY_THEME_MODES.filter((each) => images[each] === undefined)) {
		const image = await renderModeThumbnail(storyId, version, queryData, mode);
		if (image) {
			images[mode] = image;
		} else {
			brokenModes.push(mode);
		}
	}
	if (Object.keys(images).length > 0) {
		await saveThumbnails(versionId, images, theme);
	}
	if (brokenModes.length > 0) {
		throw new BrokenRenderError(brokenModes, theme);
	}
}

async function renderModeThumbnail(
	storyId: string,
	version: CustomStoryVersionView,
	queryData: Record<string, StoryQueryResult>,
	mode: StoryThemeMode,
): Promise<string | null> {
	const html = await buildCustomStoryDocumentByStoryId(storyId, version, queryData, mode);
	const { image, ...render } = await renderStoryScreenshot(html, THUMBNAIL_VIEWPORT);
	if (isBrokenRender(render)) {
		return null;
	}
	return (await toThumbnailImage(image)).toString('base64');
}

async function recordFailure(versionId: string, error: unknown): Promise<void> {
	const brokenRenders =
		(failuresByVersionId.get(versionId)?.brokenRenders ?? 0) + (error instanceof BrokenRenderError ? 1 : 0);
	if (error instanceof BrokenRenderError && brokenRenders >= MAX_BROKEN_RENDERS) {
		failuresByVersionId.delete(versionId);
		await giveUpOnModes(versionId, error);
		return;
	}
	failuresByVersionId.set(versionId, { brokenRenders, failedAt: Date.now() });
	if (!(error instanceof MissingStoryDataError)) {
		logFailure(versionId, error);
	}
}

async function giveUpOnModes(versionId: string, error: BrokenRenderError): Promise<void> {
	const images = await loadThumbnailsForTheme(versionId, error.theme);
	for (const mode of error.modes) {
		images[mode] = UNRENDERABLE;
	}
	await saveThumbnails(versionId, images, error.theme);
}

/** The saved images when they were rendered with `theme`; none when the theme changed since. */
async function loadThumbnailsForTheme(versionId: string, theme: string): Promise<ModeThumbnails> {
	const stored = await storyFileQueries.getVersionThumbnail(versionId);
	return stored?.theme === theme ? parseThumbnails(stored.thumbnail) : {};
}

async function saveThumbnails(versionId: string, images: ModeThumbnails, theme: string): Promise<void> {
	await storyFileQueries.setVersionThumbnail(versionId, JSON.stringify(images), theme);
}

function parseThumbnails(raw: string | undefined): ModeThumbnails {
	return raw ? (JSON.parse(raw) as ModeThumbnails) : {};
}

function logFailure(versionId: string, error: unknown): void {
	logger.warn('Custom story thumbnail failed', {
		source: 'system',
		context: { versionId, error: error instanceof Error ? error.message : String(error) },
	});
}

/** sharp is a native addon shipped next to the standalone binary, so it is loaded on first use. */
async function toThumbnailImage(screenshot: Buffer): Promise<Buffer> {
	const { default: sharp } = await import('sharp');
	return sharp(screenshot).resize({ width: THUMBNAIL_WIDTH }).webp({ quality: THUMBNAIL_QUALITY }).toBuffer();
}

function isCoolingDown(versionId: string): boolean {
	const failure = failuresByVersionId.get(versionId);
	return failure !== undefined && Date.now() - failure.failedAt < RETRY_AFTER_MS;
}
