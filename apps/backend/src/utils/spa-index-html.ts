import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { env } from '../env';

const SOCIAL_IMAGE_META_PATTERN = /\b(?:property|name)="(?:og:image|twitter:image)"/;
const RELATIVE_CONTENT_PATTERN = /\bcontent="(\/(?!\/)[^"]*)"/;

let cachedIndexHtml: string | undefined;

/**
 * Link unfurlers (Slack, Teams, LinkedIn...) require absolute `og:image` URLs, but the frontend
 * build cannot know the deployment origin, so the relative paths are resolved at serve time.
 */
export function getSpaIndexHtml(staticRoot: string): string {
	cachedIndexHtml ??= withAbsoluteSocialImageUrls(
		readFileSync(join(staticRoot, 'index.html'), 'utf8'),
		publicBaseUrl(),
	);
	return cachedIndexHtml;
}

export function withAbsoluteSocialImageUrls(html: string, baseUrl: string): string {
	return html.replace(/<meta\b[^>]*>/g, (metaTag) => {
		if (!SOCIAL_IMAGE_META_PATTERN.test(metaTag)) {
			return metaTag;
		}
		return metaTag.replace(RELATIVE_CONTENT_PATTERN, (_match, path: string) => `content="${baseUrl}${path}"`);
	});
}

function publicBaseUrl(): string {
	return env.BETTER_AUTH_URL.replace(/\/+$/, '');
}
