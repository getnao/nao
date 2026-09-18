import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { env } from '../env';

export type SpaPageMetadata = {
	title: string;
	description: string;
};

const SOCIAL_IMAGE_META_PATTERN = /\b(?:property|name)="(?:og:image|twitter:image)"/;
const RELATIVE_CONTENT_PATTERN = /\bcontent="(\/(?!\/)[^"]*)"/;
const META_CONTENT_PATTERN = /\bcontent="[^"]*"/;
const TITLE_TAG_PATTERN = /<title>[^<]*<\/title>/;

const TITLE_META_KEYS = ['og:title', 'twitter:title'];
const DESCRIPTION_META_KEYS = ['description', 'og:description', 'twitter:description'];

let cachedIndexHtml: string | undefined;

/**
 * Link unfurlers (Slack, Teams, LinkedIn...) require absolute `og:image` URLs, but the frontend
 * build cannot know the deployment origin, so the relative paths are resolved at serve time.
 */
export function getSpaIndexHtml(staticRoot: string, metadata?: SpaPageMetadata | null): string {
	cachedIndexHtml ??= withAbsoluteSocialImageUrls(
		readFileSync(join(staticRoot, 'index.html'), 'utf8'),
		publicBaseUrl(),
	);
	return metadata ? withPageMetadata(cachedIndexHtml, metadata) : cachedIndexHtml;
}

export function withAbsoluteSocialImageUrls(html: string, baseUrl: string): string {
	return html.replace(/<meta\b[^>]*>/g, (metaTag) => {
		if (!SOCIAL_IMAGE_META_PATTERN.test(metaTag)) {
			return metaTag;
		}
		return metaTag.replace(RELATIVE_CONTENT_PATTERN, (_match, path: string) => `content="${baseUrl}${path}"`);
	});
}

export function withPageMetadata(html: string, metadata: SpaPageMetadata): string {
	const title = escapeHtml(metadata.title);
	const description = escapeHtml(metadata.description);
	return html
		.replace(TITLE_TAG_PATTERN, () => `<title>${title}</title>`)
		.replace(/<meta\b[^>]*>/g, (metaTag) => {
			if (hasMetaKey(metaTag, TITLE_META_KEYS)) {
				return metaTag.replace(META_CONTENT_PATTERN, () => `content="${title}"`);
			}
			if (hasMetaKey(metaTag, DESCRIPTION_META_KEYS)) {
				return metaTag.replace(META_CONTENT_PATTERN, () => `content="${description}"`);
			}
			return metaTag;
		});
}

function hasMetaKey(metaTag: string, keys: string[]): boolean {
	const key = /\b(?:property|name)="([^"]*)"/.exec(metaTag)?.[1];
	return key !== undefined && keys.includes(key);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function publicBaseUrl(): string {
	return env.BETTER_AUTH_URL.replace(/\/+$/, '');
}
