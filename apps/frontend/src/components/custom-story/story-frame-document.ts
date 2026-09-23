import { STORY_HOST_MODULE, STORY_RUNTIME_MODULES } from '@nao/shared/story-app';
import { FONT_STYLESHEET_HOSTS, storyThemeToCssVars } from '@nao/shared/story-theme';
import type { StoryTheme } from '@nao/shared/story-theme';

import { KIT_STYLES } from '@/story-runtime/story-kit/styles';

export interface StoryRuntimeLocation {
	baseUrl: string;
	extension: '.js' | '.ts';
}

export interface StoryFrameDocumentInput {
	bundle: string;
	styles: string[];
	theme: StoryTheme;
	runtime: StoryRuntimeLocation;
}

/** Assembles the HTML a custom story runs in. */
export async function buildStoryFrameDocument(input: StoryFrameDocumentInput): Promise<string> {
	const runtimeOrigin = new URL(input.runtime.baseUrl).origin;
	const importMapScript = escapeScript(JSON.stringify(importMap(input.runtime)));
	const bootScript = `\nimport { bootStory } from ${JSON.stringify(STORY_HOST_MODULE)};\nbootStory(${escapeScript(
		JSON.stringify({ source: input.bundle, theme: input.theme }),
	)});\n`;
	const [importMapHash, bootHash] = await Promise.all([sha256Source(importMapScript), sha256Source(bootScript)]);

	const fontHosts = FONT_STYLESHEET_HOSTS.map((host) => `https://${host}`).join(' ');
	const csp = [
		`default-src 'none'`,
		`script-src ${importMapHash} ${bootHash} blob: ${runtimeOrigin}`,
		`style-src 'unsafe-inline' ${fontHosts}`,
		`font-src data: ${fontHosts}`,
		`img-src data: blob:`,
		`connect-src 'none'`,
		`base-uri 'none'`,
		`form-action 'none'`,
	].join('; ');

	const fontLinks = input.theme.text.fontStylesheets
		.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
		.join('\n');
	const storyStyles = input.styles.map((css) => `<style>${escapeStyle(css)}</style>`).join('\n');

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="importmap">${importMapScript}</script>
${fontLinks}
<style>${themeStyles(input.theme)}</style>
<style>${BASE_STYLES}</style>
<style>${KIT_STYLES}</style>
${storyStyles}
</head>
<body>
<div id="root"></div>
<script type="module">${bootScript}</script>
</body>
</html>`;
}

function importMap(runtime: StoryRuntimeLocation): { imports: Record<string, string> } {
	return {
		imports: Object.fromEntries(
			Object.entries(STORY_RUNTIME_MODULES).map(([specifier, file]) => [
				specifier,
				`${runtime.baseUrl}${file}${runtime.extension}`,
			]),
		),
	};
}

function themeStyles(theme: StoryTheme): string {
	const declarations = Object.entries(storyThemeToCssVars(theme))
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
	return `:root{${declarations}}`;
}

const BASE_STYLES = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--background);color:var(--story-body-color);font-family:var(--font-sans);font-size:var(--story-body-size);line-height:var(--story-line-height);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4,h5,h6{font-family:var(--font-heading);color:var(--foreground);letter-spacing:var(--story-heading-tracking);margin:0}
#root{min-height:100vh}
.nao-story-crash{margin:16px;padding:12px 16px;border-radius:8px;background:#fef2f2;color:#991b1b;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap}
`;

async function sha256Source(source: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
	return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

/** JSON is valid JS, but `</script>` inside a string would still end the block; escaping `<` closes that door. */
function escapeScript(json: string): string {
	return json.replaceAll('<', '\\u003c');
}

function escapeStyle(css: string): string {
	return css.replaceAll(/<\/style/gi, '<\\/style');
}

function escapeAttribute(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
