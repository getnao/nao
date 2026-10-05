import { STORY_HOST_MODULE, STORY_RUNTIME_MODULES } from '@nao/shared/story-app';
import { composeStoryDocument, escapeScript, storyStylesheets } from '@nao/shared/story-document';
import { storyMapTileCspSources } from '@nao/shared/story-map-tiles';
import { FONT_STYLESHEET_HOSTS } from '@nao/shared/story-theme';
import type { StoryApp } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

export interface StoryRuntimeLocation {
	baseUrl: string;
	extension: '.js' | '.ts';
}

export interface StoryFrameDocumentInput {
	app: StoryApp;
	styles: string[];
	theme: StoryTheme;
	runtime: StoryRuntimeLocation;
	channel: string;
}

/** Assembles the HTML a custom story runs in. */
export async function buildStoryFrameDocument(input: StoryFrameDocumentInput): Promise<string> {
	const runtimeOrigin = new URL(input.runtime.baseUrl).origin;
	const importMapScript = escapeScript(JSON.stringify(importMap(input.runtime)));
	const boot = {
		kind: input.app.kind,
		source: input.app.bundle,
		theme: input.theme,
		channel: input.channel,
	};
	const bootScript = `\nimport { bootStory } from ${JSON.stringify(STORY_HOST_MODULE)};\nbootStory(${escapeScript(
		JSON.stringify(boot),
	)});\n`;
	const [importMapHash, bootHash] = await Promise.all([sha256Source(importMapScript), sha256Source(bootScript)]);

	const fontHosts = FONT_STYLESHEET_HOSTS.map((host) => `https://${host}`).join(' ');
	const tileHosts = storyMapTileCspSources().join(' ');
	const csp = [
		`default-src 'none'`,
		`script-src ${importMapHash} ${bootHash} blob: ${runtimeOrigin}`,
		`style-src 'unsafe-inline' ${fontHosts}`,
		`font-src data: ${fontHosts}`,
		`img-src data: blob: ${tileHosts}`,
		`connect-src 'none'`,
		`base-uri 'none'`,
		`form-action 'none'`,
	].join('; ');

	return composeStoryDocument(input.app, {
		head: [
			`<meta charset="utf-8">`,
			`<meta http-equiv="Content-Security-Policy" content="${csp}">`,
			`<meta name="viewport" content="width=device-width, initial-scale=1">`,
			`<script type="importmap">${importMapScript}</script>`,
			storyStylesheets(input.theme, input.styles),
		].join('\n'),
		body: `<script type="module">${bootScript}</script>`,
	});
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
