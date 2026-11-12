import type { ChartPluginManifestEntry } from '@nao/shared';
import type { StoryQueryResult } from '@nao/shared/story-app';
import { STORY_THEME_MODES, type StoryThemeMode, type StoryThemePair } from '@nao/shared/story-theme';
import { createHash } from 'crypto';

import type { DBStory, DBStoryAppState } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyAppStateQueries from '../queries/story-app-state.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import { logger } from '../utils/logger';
import { themeFontStylesheets } from '../utils/story-headless-page';
import { isBrokenRender, renderStoryScreenshot } from '../utils/story-screenshot';
import { storyThemeFingerprint } from '../utils/story-theme-fingerprint';
import { listStoryChartPlugins } from './chart-plugin';
import {
	type CustomStoryVersionView,
	getActiveThemeForStory,
	getLatestCustomStoryVersionByStoryId,
	getStoredCustomStoryQueryDataByStoryId,
} from './custom-story';
import { buildCustomStoryDocumentByStoryId } from './custom-story-export';
import { hasEffectiveWarehouseRestrictions } from './user-group-context-access.service';

const THUMBNAIL_VIEWPORT = { width: 1280, height: 980 };
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_QUALITY = 80;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const MISSING_DATA_RETRY_AFTER_MS = 15 * 1000;
const MAX_BROKEN_RENDERS = 3;
/** Stored in place of a mode's image when the version has no app or that mode kept rendering broken: never retried. */
const UNRENDERABLE = '';
const CHART_PLUGINS_FINGERPRINT_TTL_MS = 60 * 1000;

const chartPluginsFingerprints = new Map<string, { fingerprint: string | undefined; expiresAt: number }>();

/** Base64 WebP per theme mode; a mode not rendered yet is absent. */
type ModeThumbnails = Partial<Record<StoryThemeMode, string>>;

interface StoredThumbnails {
	images: ModeThumbnails;
	redactedImages: ModeThumbnails;
}

/** The latest failure of a story's thumbnail, so a superseded version's entry is replaced rather than kept. */
interface RenderFailure {
	versionId: string;
	renderKey: string | null;
	brokenRenders: number;
	failedAt: number;
	retryAfterMs: number;
}

const queuedVersionIds = new Set<string>();
const failuresByStoryId = new Map<string, RenderFailure>();
let renderQueue: Promise<void> = Promise.resolve();

class MissingStoryDataError extends Error {}

class UnbuiltVersionError extends Error {}

class BrokenRenderError extends Error {
	constructor(
		readonly modes: StoryThemeMode[],
		readonly renderKey: string,
	) {
		super(`Broken render in ${modes.join(', ')} mode.`);
	}
}

export interface CustomStoryThumbnail {
	versionId: string;
	/** What the image was rendered from: the theme, and for a live story the data refresh. */
	renderKey: string;
	isCurrent: boolean;
	image: Buffer;
	redactedImage: Buffer | null;
}

export async function canShowStoredCustomStoryThumbnail(storyId: string, userId: string): Promise<boolean> {
	if ((await storyQueries.getStoryOwnerId(storyId)) === userId) {
		return true;
	}
	const projectId = await storyQueries.getStoryProjectId(storyId);
	return projectId !== null && !(await hasEffectiveWarehouseRestrictions(projectId, userId));
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
	const { images, redactedImages } = parseThumbnails(stored?.thumbnail);
	const currentKey = await thumbnailRenderKey(story, await getActiveThemeForStory(story.id));
	const isCurrent =
		stored?.renderKey === currentKey &&
		STORY_THEME_MODES.every((each) => images[each] !== undefined && redactedImages[each] !== undefined);
	if (!isCurrent) {
		queueCustomStoryThumbnail(story.id, version.id);
	}
	const image = images[mode];
	if (!stored?.renderKey || !image) {
		return null;
	}
	return {
		versionId: version.id,
		renderKey: stored.renderKey,
		isCurrent,
		image: Buffer.from(image, 'base64'),
		redactedImage: redactedImages[mode] ? Buffer.from(redactedImages[mode], 'base64') : null,
	};
}

/** Renders thumbnails in the background one at a time so they do not compete with viewers. */
export function queueCustomStoryThumbnail(storyId: string, versionId: string): void {
	if (queuedVersionIds.has(versionId) || isCoolingDown(storyId, versionId)) {
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
		if (failuresByStoryId.get(storyId)?.versionId === versionId) {
			failuresByStoryId.delete(storyId);
		}
	} catch (error) {
		await recordFailure(storyId, versionId, error).catch((recordError) => logFailure(versionId, recordError));
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
	const story = await storyQueries.getStoryById(storyId);
	const renderKey = await thumbnailRenderKey({ id: storyId, isLive: story?.isLive ?? false }, version.theme);
	if (!version.app) {
		const unavailable = { light: UNRENDERABLE, dark: UNRENDERABLE };
		const saved = await saveThumbnails(versionId, { images: unavailable, redactedImages: unavailable }, renderKey);
		if (!saved) {
			throw new UnbuiltVersionError('The version has no bundle to render.');
		}
		return;
	}
	const queryData = await getStoredCustomStoryQueryDataByStoryId(storyId, version.queryIds);
	if (Object.keys(queryData).length < version.queryIds.length) {
		throw new MissingStoryDataError('Some queries have no saved result yet.');
	}

	const thumbnails = await loadThumbnailsForKey(versionId, renderKey);
	const brokenModes: StoryThemeMode[] = [];
	for (const mode of STORY_THEME_MODES.filter(
		(each) => thumbnails.images[each] === undefined || thumbnails.redactedImages[each] === undefined,
	)) {
		const rendered = await renderModeThumbnail(storyId, version, queryData, mode);
		if (rendered) {
			thumbnails.images[mode] = rendered.image;
			thumbnails.redactedImages[mode] = rendered.redactedImage;
		} else {
			brokenModes.push(mode);
		}
	}
	if (Object.keys(thumbnails.images).length > 0 || Object.keys(thumbnails.redactedImages).length > 0) {
		await saveThumbnails(versionId, thumbnails, renderKey);
	}
	if (brokenModes.length > 0) {
		throw new BrokenRenderError(brokenModes, renderKey);
	}
}

async function renderModeThumbnail(
	storyId: string,
	version: CustomStoryVersionView,
	queryData: Record<string, StoryQueryResult>,
	mode: StoryThemeMode,
): Promise<{ image: string; redactedImage: string } | null> {
	const html = await buildCustomStoryDocumentByStoryId(storyId, version, queryData, mode);
	const { image, redactedImage, ...render } = await renderStoryScreenshot(
		html,
		THUMBNAIL_VIEWPORT,
		themeFontStylesheets(version.theme),
		{ redactData: true },
	);
	if (isBrokenRender(render) || !redactedImage) {
		return null;
	}
	const [thumbnail, redactedThumbnail] = await Promise.all([
		toThumbnailImage(image),
		toThumbnailImage(redactedImage),
	]);
	return {
		image: thumbnail.toString('base64'),
		redactedImage: redactedThumbnail.toString('base64'),
	};
}

/** Broken renders count per version and render key, so a theme edit or a data refresh gets a fresh retry budget. */
async function recordFailure(storyId: string, versionId: string, error: unknown): Promise<void> {
	const previous = failuresByStoryId.get(storyId);
	const renderKey = error instanceof BrokenRenderError ? error.renderKey : null;
	const isSameRender = previous?.versionId === versionId && previous.renderKey === renderKey;
	const brokenRenders = (isSameRender ? previous.brokenRenders : 0) + (error instanceof BrokenRenderError ? 1 : 0);
	if (error instanceof BrokenRenderError && brokenRenders >= MAX_BROKEN_RENDERS) {
		failuresByStoryId.delete(storyId);
		await giveUpOnModes(versionId, error);
		return;
	}
	failuresByStoryId.set(storyId, {
		versionId,
		renderKey,
		brokenRenders,
		failedAt: Date.now(),
		retryAfterMs: retryDelayFor(error),
	});
	if (!(error instanceof MissingStoryDataError) && !(error instanceof UnbuiltVersionError)) {
		logFailure(versionId, error);
	}
}

/** Saved results can land any time, so a story waiting on them is retried soon; an unbuilt version never is. */
function retryDelayFor(error: unknown): number {
	if (error instanceof UnbuiltVersionError) {
		return Number.POSITIVE_INFINITY;
	}
	return error instanceof MissingStoryDataError ? MISSING_DATA_RETRY_AFTER_MS : RETRY_AFTER_MS;
}

async function giveUpOnModes(versionId: string, error: BrokenRenderError): Promise<void> {
	const thumbnails = await loadThumbnailsForKey(versionId, error.renderKey);
	for (const mode of error.modes) {
		thumbnails.images[mode] = UNRENDERABLE;
		thumbnails.redactedImages[mode] = UNRENDERABLE;
	}
	await saveThumbnails(versionId, thumbnails, error.renderKey);
}

/** The saved images when they were rendered for `renderKey`; none when the theme or the data changed since. */
async function loadThumbnailsForKey(versionId: string, renderKey: string): Promise<StoredThumbnails> {
	const stored = await storyFileQueries.getVersionThumbnail(versionId);
	return stored?.renderKey === renderKey ? parseThumbnails(stored.thumbnail) : { images: {}, redactedImages: {} };
}

async function saveThumbnails(versionId: string, thumbnails: StoredThumbnails, renderKey: string): Promise<boolean> {
	return storyFileQueries.setVersionThumbnail(versionId, JSON.stringify(thumbnails), renderKey);
}

/** Live data, shared state and project chart plugins change in place, without a new version, so they are part of the key. */
async function thumbnailRenderKey(
	story: Pick<DBStory, 'id' | 'isLive'>,
	theme: StoryThemePair | null,
): Promise<string> {
	const [dataCachedAt, sharedState, chartPlugins] = await Promise.all([
		story.isLive ? storyQueries.getStoryDataCachedAt(story.id) : null,
		storyAppStateQueries.listProjectStoryAppState(story.id),
		cachedChartPluginsFingerprint(story.id),
	]);
	return [
		`${THUMBNAIL_VIEWPORT.width}x${THUMBNAIL_VIEWPORT.height}`,
		storyThemeFingerprint(theme),
		dataCachedAt?.getTime(),
		sharedState.length > 0 ? sharedStateFingerprint(sharedState) : undefined,
		chartPlugins,
	]
		.filter((part) => part !== undefined)
		.join('.');
}

function sharedStateFingerprint(state: DBStoryAppState[]): string {
	const entries = state
		.map((entry) => [entry.key, entry.value])
		.sort(([left], [right]) => String(left).localeCompare(String(right)));
	return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 12);
}

/** Plugins are read from disk, so their fingerprint is reused for a minute rather than recomputed on every thumbnail request. */
async function cachedChartPluginsFingerprint(storyId: string): Promise<string | undefined> {
	const cached = chartPluginsFingerprints.get(storyId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.fingerprint;
	}
	const plugins = await listStoryChartPlugins(storyId);
	const fingerprint = plugins.length > 0 ? chartPluginsFingerprint(plugins) : undefined;
	chartPluginsFingerprints.set(storyId, { fingerprint, expiresAt: Date.now() + CHART_PLUGINS_FINGERPRINT_TTL_MS });
	return fingerprint;
}

function chartPluginsFingerprint(plugins: ChartPluginManifestEntry[]): string {
	const versions = plugins.map((plugin) => `${plugin.type}@${plugin.version}`).sort();
	return createHash('sha256').update(versions.join('\n')).digest('hex').slice(0, 12);
}

function parseThumbnails(raw: string | undefined): StoredThumbnails {
	if (!raw) {
		return { images: {}, redactedImages: {} };
	}
	const parsed = JSON.parse(raw) as ModeThumbnails & {
		images?: ModeThumbnails;
		redactedImages?: ModeThumbnails;
	};
	return parsed.images
		? { images: parsed.images, redactedImages: parsed.redactedImages ?? {} }
		: { images: parsed, redactedImages: {} };
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

function isCoolingDown(storyId: string, versionId: string): boolean {
	const failure = failuresByStoryId.get(storyId);
	return failure?.versionId === versionId && Date.now() - failure.failedAt < failure.retryAfterMs;
}
