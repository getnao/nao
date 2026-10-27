import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LinkPreview } from '../services/link-preview.service';

const PREVIEW_META_PATTERN = /\s*<meta\s[^>]*(?:property="og:[^"]*"|name="(?:description|twitter:[^"]*)")[^>]*>/g;
const TITLE_PATTERN = /\s*<title>[\s\S]*?<\/title>/;

let cachedIndexHtml: Promise<string> | null = null;

export async function renderAppShell(staticRoot: string, preview: LinkPreview): Promise<string> {
	return injectLinkPreview(await readIndexHtml(staticRoot), preview);
}

export function injectLinkPreview(html: string, preview: LinkPreview): string {
	const tags = buildPreviewTags(preview)
		.map((tag) => `\t\t${tag}`)
		.join('\n');
	return html.replace(PREVIEW_META_PATTERN, '').replace(TITLE_PATTERN, '').replace('</head>', `${tags}\n\t</head>`);
}

function buildPreviewTags(preview: LinkPreview): string[] {
	const tags = [
		`<title>${escapeHtml(preview.title)}</title>`,
		metaTag('name', 'description', preview.description),
		metaTag('property', 'og:type', 'website'),
		metaTag('property', 'og:site_name', preview.siteName),
		metaTag('property', 'og:title', preview.title),
		metaTag('property', 'og:description', preview.description),
		metaTag('name', 'twitter:card', preview.hasLargeImage ? 'summary_large_image' : 'summary'),
		metaTag('name', 'twitter:title', preview.title),
		metaTag('name', 'twitter:description', preview.description),
	];
	if (preview.imageUrl) {
		tags.push(
			metaTag('property', 'og:image', preview.imageUrl),
			metaTag('name', 'twitter:image', preview.imageUrl),
		);
	}
	return tags;
}

function metaTag(attribute: 'name' | 'property', key: string, content: string): string {
	return `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** The built index.html never changes while the server runs; a failed read is retried on the next request. */
function readIndexHtml(staticRoot: string): Promise<string> {
	if (!cachedIndexHtml) {
		cachedIndexHtml = readFile(join(staticRoot, 'index.html'), 'utf8').catch((error: unknown) => {
			cachedIndexHtml = null;
			throw error;
		});
	}
	return cachedIndexHtml;
}
