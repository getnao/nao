import type { ChartPluginManifestEntry } from '@nao/shared';
import { STORY_QUERY_ACCESS_DENIED_MESSAGE, type StoryQueryResult } from '@nao/shared/story-app';
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
	CustomStoryNotFoundError,
	CustomStoryQueryExecutionError,
	type CustomStoryVersionView,
	getActiveThemeForStory,
	getCustomStoryNarratives,
	getCustomStoryQueryData,
	getLatestCustomStoryVersionByStoryId,
	getStoredCustomStoryQueryDataByStoryId,
} from './custom-story';
import { buildCustomStoryDocumentByStoryId } from './custom-story-export';
import { getCustomStoryStateByStoryId } from './custom-story-state';
import { createStoryExecutionContext } from './live-story';
import { hasEffectiveWarehouseRestrictions } from './user-group-context-access.service';

const THUMBNAIL_VIEWPORT = { width: 1280, height: 980 };
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_QUALITY = 80;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const MISSING_DATA_RETRY_AFTER_MS = 15 * 1000;
const MAX_BROKEN_RENDERS = 3;
const VIEWER_THUMBNAIL_TTL_MS = 60 * 1000;
const MAX_VIEWER_THUMBNAILS = 100;
/** Stored in place of a mode's image when the version has no app or that mode kept rendering broken: never retried. */
const UNRENDERABLE = '';
const CHART_PLUGINS_FINGERPRINT_TTL_MS = 60 * 1000;

const chartPluginsFingerprints = new Map<string, { fingerprint: string | undefined; expiresAt: number }>();

/** Base64 WebP per theme mode; a mode not rendered yet is absent. */
type ModeThumbnails = Partial<Record<StoryThemeMode, string>>;

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
const viewerThumbnails = new Map<string, { image: Buffer; expiresAt: number }>();
const pendingViewerThumbnails = new Map<string, Promise<Buffer | null>>();
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
	const images = parseThumbnails(stored?.thumbnail);
	const currentKey = await thumbnailRenderKey(story, await getActiveThemeForStory(story.id));
	const isCurrent = stored?.renderKey === currentKey && STORY_THEME_MODES.every((each) => images[each] !== undefined);
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
	};
}

export async function getViewerCustomStoryThumbnail(
	story: DBStory,
	viewerUserId: string,
	mode: StoryThemeMode = 'light',
): Promise<Buffer | null> {
	const chatId = story.chatId;
	if (!chatId) {
		return null;
	}
	let version: CustomStoryVersionView;
	try {
		version = await getLatestCustomStoryVersionByStoryId(story.id);
	} catch (error) {
		if (error instanceof CustomStoryNotFoundError) {
			return null;
		}
		throw error;
	}
	const executionContext = await createStoryExecutionContext(chatId, viewerUserId);
	const key = `${version.version.id}:${viewerUserId}:${executionContext.permissionRevision}:${mode}`;
	const cached = viewerThumbnails.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.image;
	}
	const pending = pendingViewerThumbnails.get(key);
	if (pending) {
		return pending;
	}
	const rendering = renderViewerThumbnail(story, version, viewerUserId, mode)
		.catch((error) => {
			logFailure(version.version.id, error);
			return null;
		})
		.then((image) => {
			if (image) {
				cacheViewerThumbnail(key, image);
			}
			return image;
		})
		.finally(() => pendingViewerThumbnails.delete(key));
	pendingViewerThumbnails.set(key, rendering);
	return rendering;
}

async function renderViewerThumbnail(
	story: DBStory,
	version: CustomStoryVersionView,
	viewerUserId: string,
	mode: StoryThemeMode,
): Promise<Buffer | null> {
	if (!story.chatId) {
		return null;
	}
	const chatId = story.chatId;
	const [queryEntries, narratives, state] = await Promise.all([
		Promise.all(
			version.queryIds.map(async (queryId): Promise<[string, StoryQueryResult] | null> => {
				try {
					const result = await getCustomStoryQueryData(chatId, story.slug, queryId, {
						storyVersionId: version.version.id,
						viewerUserId,
					});
					return [queryId, result];
				} catch (error) {
					if (
						error instanceof CustomStoryQueryExecutionError &&
						error.message === STORY_QUERY_ACCESS_DENIED_MESSAGE
					) {
						return [queryId, { columns: [], data: [], accessDenied: true }];
					}
					throw error;
				}
			}),
		),
		getCustomStoryNarratives(chatId, story.slug, {
			storyVersionId: version.version.id,
			viewerUserId,
		}),
		getCustomStoryStateByStoryId(story.id, viewerUserId),
	]);
	const queryData = Object.fromEntries(
		queryEntries.filter((entry): entry is [string, StoryQueryResult] => entry !== null),
	);
	const html = await buildCustomStoryDocumentByStoryId(story.id, version, queryData, mode, {
		narratives,
		state,
	});
	const { image, ...render } = await renderStoryScreenshot(
		html,
		THUMBNAIL_VIEWPORT,
		themeFontStylesheets(version.theme),
	);
	return isBrokenRender(render) ? null : toThumbnailImage(image);
}

function cacheViewerThumbnail(key: string, image: Buffer): void {
	if (viewerThumbnails.size >= MAX_VIEWER_THUMBNAILS) {
		viewerThumbnails.delete(viewerThumbnails.keys().next().value!);
	}
	viewerThumbnails.set(key, { image, expiresAt: Date.now() + VIEWER_THUMBNAIL_TTL_MS });
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
		const saved = await saveThumbnails(versionId, { light: UNRENDERABLE, dark: UNRENDERABLE }, renderKey);
		if (!saved) {
			throw new UnbuiltVersionError('The version has no bundle to render.');
		}
		return;
	}
	const queryData = await getStoredCustomStoryQueryDataByStoryId(storyId, version.queryIds);
	if (Object.keys(queryData).length < version.queryIds.length) {
		throw new MissingStoryDataError('Some queries have no saved result yet.');
	}

	const images = await loadThumbnailsForKey(versionId, renderKey);
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
		await saveThumbnails(versionId, images, renderKey);
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
): Promise<string | null> {
	const html = await buildCustomStoryDocumentByStoryId(storyId, version, queryData, mode);
	const { image, ...render } = await renderStoryScreenshot(
		html,
		THUMBNAIL_VIEWPORT,
		themeFontStylesheets(version.theme),
	);
	if (isBrokenRender(render)) {
		return null;
	}
	return (await toThumbnailImage(image)).toString('base64');
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
	const images = await loadThumbnailsForKey(versionId, error.renderKey);
	for (const mode of error.modes) {
		images[mode] = UNRENDERABLE;
	}
	await saveThumbnails(versionId, images, error.renderKey);
}

/** The saved images when they were rendered for `renderKey`; none when the theme or the data changed since. */
async function loadThumbnailsForKey(versionId: string, renderKey: string): Promise<ModeThumbnails> {
	const stored = await storyFileQueries.getVersionThumbnail(versionId);
	return stored?.renderKey === renderKey ? parseThumbnails(stored.thumbnail) : {};
}

async function saveThumbnails(versionId: string, images: ModeThumbnails, renderKey: string): Promise<boolean> {
	return storyFileQueries.setVersionThumbnail(versionId, JSON.stringify(images), renderKey);
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

function parseThumbnails(raw: string | undefined): ModeThumbnails {
	if (!raw) {
		return {};
	}
	const parsed = JSON.parse(raw) as ModeThumbnails & { images?: ModeThumbnails };
	return parsed.images ?? parsed;
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
