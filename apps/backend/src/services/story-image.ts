import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { StoryApp, StoryQueryResult } from '@nao/shared/story-app';
import {
	findDirectStoryImageSources,
	findStoryImageSources,
	findStoryImageTemplates,
	isAllowedStoryImageSource,
	isStoryImageMediaType,
	isStoryImageSourceWithin,
	isStoryImageTemplateBlocked,
	MAX_STORY_IMAGE_BYTES,
	parseStoryImageSource,
	readEmbeddableStoryImages,
	storyAppCode,
	type StoryImageLocation,
	storyImageMediaTypeFromPath,
	type StoryImageResult,
} from '@nao/shared/story-image';
import { GoogleAuth } from 'google-auth-library';

import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import type { AgentSettings } from '../types/agent-settings';
import { buildImageDataUrl } from '../utils/image';
import { safeFetchBytes, type SafeFetchBytesResult } from '../utils/safe-fetch';
import { chunk } from '../utils/utils';

const GCS_READ_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';
const BUCKET_READ_TIMEOUT_MS = 15_000;
const STORY_IMAGES_SETTINGS = 'Settings › Agent › Story images';
const CONCURRENT_IMAGE_READS = 3;
const MAX_STORY_IMAGE_CHARS_PER_REQUEST = 20 * 1024 * 1024;
const REQUEST_BUDGET_MESSAGE = 'Too many large images were asked for at once.';
const NOT_ALLOWED_MESSAGE = `This image source is not allowed. Ask an admin to add it in ${STORY_IMAGES_SETTINGS}.`;

type FetchedImage = Pick<SafeFetchBytesResult, 'bytes' | 'contentType'>;

let googleAuth: GoogleAuth | null = null;
let s3Client: S3Client | null = null;

/** nao reads each image with its own credentials and hands it back as a `data:` URL, as the frame reaches no host. */
export async function readStoryImages(projectId: string, sources: string[]): Promise<Record<string, StoryImageResult>> {
	return readAllowedStoryImages(await getAllowedStoryImageSources(projectId), sources);
}

/** The images a printed, emailed or thumbnailed story embeds, since that page cannot ask nao for them. */
export async function readStoryImagesForExport(
	storyId: string,
	app: StoryApp,
	queries: Record<string, StoryQueryResult>,
): Promise<Record<string, string>> {
	const projectId = await storyQueries.getStoryProjectId(storyId);
	const allowedSources = projectId ? await getAllowedStoryImageSources(projectId) : [];
	if (allowedSources.length === 0) {
		return {};
	}
	const isAllowed = (src: string) => isAllowedStoryImageSource(src, allowedSources);
	const sources = findStoryImageSources(storyAppCode(app), queries, { isWanted: isAllowed });
	return readEmbeddableStoryImages(sources, (batch) => readAllowedStoryImages(allowedSources, batch));
}

/** Template links are judged by their fixed start only: filled from every query's rows, they would block on images nobody sees. */
export async function findBlockedStoryImageSources(
	projectId: string,
	files: string[],
	queries: Record<string, StoryQueryResult>,
): Promise<string[]> {
	const allowedSources = await getAllowedStoryImageSources(projectId);
	const isBlocked = (src: string) => !isAllowedStoryImageSource(src, allowedSources);
	const shown = findDirectStoryImageSources(files).filter(isBlocked);
	const named = findStoryImageSources(files, queries, {
		isWanted: (src) => storyImageMediaTypeFromPath(src) !== null && isBlocked(src),
		fillsTemplates: false,
	});
	const templates = findStoryImageTemplates(files).filter((template) =>
		isStoryImageTemplateBlocked(template, allowedSources),
	);
	return [...new Set([...shown, ...named, ...templates])];
}

export function describeBlockedStoryImages(sources: string[]): string {
	return `It shows images from sources this project does not allow (${sources.join(', ')}). Ask the user whether to go on without them; an admin can allow them in ${STORY_IMAGES_SETTINGS}.`;
}

export async function getAllowedStoryImageSources(projectId: string): Promise<string[]> {
	return allowedStoryImageSources(await projectQueries.getAgentSettings(projectId));
}

/** Bucket entries only count inside the operator's buckets, as nao reads them with the server's own credentials. */
export function allowedStoryImageSources(settings: AgentSettings | null): string[] {
	return (settings?.storyImages?.allowedSources ?? []).filter(isStoryImageSourceAllowedByOperator);
}

export function isStoryImageSourceAllowedByOperator(entry: string): boolean {
	return entry.startsWith('https://') || isStoryImageSourceWithin(entry, env.NAO_STORY_IMAGE_BUCKETS);
}

/** A few images load at a time and the request stops once its budget is spent, so one call cannot fill the server's memory. */
async function readAllowedStoryImages(
	allowedSources: string[],
	sources: string[],
): Promise<Record<string, StoryImageResult>> {
	const results: Record<string, StoryImageResult> = {};
	let totalChars = 0;
	for (const group of chunk([...new Set(sources)], CONCURRENT_IMAGE_READS)) {
		const isOverBudget = totalChars >= MAX_STORY_IMAGE_CHARS_PER_REQUEST;
		const groupResults = isOverBudget
			? group.map((): StoryImageResult => ({ error: REQUEST_BUDGET_MESSAGE }))
			: await Promise.all(group.map((src) => readStoryImage(src, allowedSources)));
		for (const [index, src] of group.entries()) {
			const result = groupResults[index];
			totalChars += 'dataUri' in result ? result.dataUri.length : 0;
			results[src] = result;
		}
	}
	return results;
}

async function readStoryImage(src: string, allowedSources: string[]): Promise<StoryImageResult> {
	const location = parseStoryImageSource(src);
	if (!location || !isAllowedStoryImageSource(src, allowedSources)) {
		return { error: NOT_ALLOWED_MESSAGE };
	}
	try {
		const image = await fetchImage(src, location, allowedSources);
		return { dataUri: toDataUri(image, location.path) };
	} catch (error) {
		return { error: `Could not load the image: ${error instanceof Error ? error.message : String(error)}` };
	}
}

function fetchImage(src: string, location: StoryImageLocation, allowedSources: string[]): Promise<FetchedImage> {
	switch (location.scheme) {
		case 'gs':
			return fetchGcsImage(location.host, location.path.slice(1));
		case 's3':
			return fetchS3Image(location.host, location.path.slice(1));
		case 'https':
			return fetchHttpsImage(src, allowedSources);
	}
}

/** A redirect can lead off the allowed hosts, so the URL the image finally came from is checked again. */
async function fetchHttpsImage(src: string, allowedSources: string[]): Promise<FetchedImage> {
	const image = await safeFetchBytes(src, { maxBytes: MAX_STORY_IMAGE_BYTES, headers: { accept: 'image/*' } });
	if (!isAllowedStoryImageSource(image.url, allowedSources)) {
		throw new Error('The image redirected to a source that is not allowed.');
	}
	return image;
}

/** Application Default Credentials: a mounted service account key, workload identity or the GCE metadata server. */
async function fetchGcsImage(bucket: string, key: string): Promise<FetchedImage> {
	googleAuth ??= new GoogleAuth({ scopes: [GCS_READ_SCOPE] });
	const token = await googleAuth.getAccessToken();
	if (!token) {
		throw new Error('nao has no Google Cloud credentials to read this bucket.');
	}
	const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`;
	const response = await fetch(url, {
		headers: { authorization: `Bearer ${token}`, range: oversizeProbeRange(), 'accept-encoding': 'identity' },
		signal: AbortSignal.timeout(BUCKET_READ_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`Google Cloud Storage answered ${response.status}.`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	return { bytes: assertWithinSizeLimit(bytes), contentType: response.headers.get('content-type') ?? undefined };
}

/** The default AWS credential chain: environment keys, a shared profile, or an ECS, EKS or EC2 role. */
async function fetchS3Image(bucket: string, key: string): Promise<FetchedImage> {
	s3Client ??= new S3Client({
		region: process.env.AWS_REGION || 'us-east-1',
		followRegionRedirects: true,
		credentials: fromNodeProviderChain(),
	});
	const response = await s3Client.send(
		new GetObjectCommand({ Bucket: bucket, Key: key, Range: oversizeProbeRange() }),
		{ abortSignal: AbortSignal.timeout(BUCKET_READ_TIMEOUT_MS) },
	);
	if (!response.Body) {
		throw new Error('The object has no content.');
	}
	const bytes = Buffer.from(await response.Body.transformToByteArray());
	return { bytes: assertWithinSizeLimit(bytes), contentType: response.ContentType };
}

/** Asks for one byte past the limit, so an oversized object is detected without downloading all of it. */
function oversizeProbeRange(): string {
	return `bytes=0-${MAX_STORY_IMAGE_BYTES}`;
}

function assertWithinSizeLimit(bytes: Buffer): Buffer {
	if (bytes.byteLength > MAX_STORY_IMAGE_BYTES) {
		throw new Error(`Images are limited to ${MAX_STORY_IMAGE_BYTES / 1024 / 1024} MB.`);
	}
	return bytes;
}

/** Buckets often serve `application/octet-stream`, so the file extension is the fallback for the media type. */
function toDataUri(image: FetchedImage, path: string): string {
	const declared = image.contentType?.split(';')[0].trim().toLowerCase();
	const mediaType = declared && isStoryImageMediaType(declared) ? declared : storyImageMediaTypeFromPath(path);
	if (!mediaType) {
		throw new Error('The file is not a supported image.');
	}
	return buildImageDataUrl(mediaType, image.bytes.toString('base64'));
}
