import { STORY_HOST_MODULE, STORY_RUNTIME_MODULES } from '@nao/shared/story-app';
import { escapeScript, storyStylesheets } from '@nao/shared/story-document';
import { FONT_STYLESHEET_HOSTS } from '@nao/shared/story-theme';
import type { StoryTheme } from '@nao/shared/story-theme';

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

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="importmap">${importMapScript}</script>
${storyStylesheets(input.theme, input.styles)}
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

async function sha256Source(source: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
	return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}
