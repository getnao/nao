import { STORY_HOST_MODULE, STORY_STANDALONE_RUNTIME_GLOBAL } from '@nao/shared/story-app';
import { FONT_STYLESHEET_HOSTS } from '@nao/shared/story-theme';
import { escapeAttribute, escapeScript, storyStylesheets } from './story-frame-document';
import type { StoryExportData } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

export interface StoryExportDocumentInput {
	title: string;
	bundle: string;
	styles: string[];
	theme: StoryTheme;
	runtime: string;
	data: StoryExportData;
}

const PAYLOAD_ELEMENT_ID = 'nao-story-export';
const DATE_MARKER = '$naoDate';

/**
 * A downloaded custom story runs the same code as in the app: the standalone runtime, the story bundle and the data
 * it queries are embedded, so charts keep their tooltips and decks their navigation, offline and without the host.
 */
export function buildStoryExportDocument(input: StoryExportDocumentInput): string {
	const payload = {
		runtime: input.runtime,
		boot: { source: input.bundle, theme: input.theme, exportData: input.data },
	};
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${exportContentSecurityPolicy()}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttribute(input.title)}</title>
${storyStylesheets(input.theme, input.styles)}
</head>
<body>
<div id="root"></div>
<script type="application/json" id="${PAYLOAD_ELEMENT_ID}">${escapeScript(JSON.stringify(payload, encodeDates))}</script>
<script>${EXPORT_LOADER}</script>
</body>
</html>`;
}

/** Scripts only come from the page itself: no request can leave it except for the theme fonts. */
function exportContentSecurityPolicy(): string {
	const fontHosts = FONT_STYLESHEET_HOSTS.map((host) => `https://${host}`).join(' ');
	return [
		`default-src 'none'`,
		`script-src 'unsafe-inline' blob:`,
		`style-src 'unsafe-inline' ${fontHosts}`,
		`font-src data: ${fontHosts}`,
		`img-src data: blob:`,
		`connect-src 'none'`,
		`base-uri 'none'`,
		`form-action 'none'`,
	].join('; ');
}

/** Query rows reach the frame with their `Date`s intact; JSON would flatten them to strings, so they are tagged. */
function encodeDates(this: Record<string, unknown>, key: string, value: unknown): unknown {
	const raw = this[key];
	if (raw instanceof Date) {
		return { [DATE_MARKER]: raw.toISOString() };
	}
	if (typeof raw === 'bigint') {
		return Number(raw);
	}
	return value;
}

/**
 * Loads the runtime from a blob, exposes each of its modules to the import map under its bare specifier,
 * then boots the story the way the frame does.
 */
const EXPORT_LOADER = `
(() => {
	const payload = JSON.parse(document.getElementById(${JSON.stringify(PAYLOAD_ELEMENT_ID)}).textContent, (key, value) =>
		value && typeof value === 'object' && ${JSON.stringify(DATE_MARKER)} in value ? new Date(value[${JSON.stringify(DATE_MARKER)}]) : value,
	);
	const toModuleUrl = (source) => URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	const isIdentifier = (name) => /^[A-Za-z_$][\\w$]*$/.test(name);
	const shimSource = (specifier, namespace) => {
		const names = Object.keys(namespace).filter((name) => name !== 'default' && isIdentifier(name));
		return [
			'const m = globalThis[' + JSON.stringify(${JSON.stringify(STORY_STANDALONE_RUNTIME_GLOBAL)}) + '][' + JSON.stringify(specifier) + '];',
			'default' in namespace ? 'export default m.default;' : '',
			names.length > 0 ? 'export const { ' + names.join(', ') + ' } = m;' : '',
		].join('\\n');
	};

	const runtime = document.createElement('script');
	runtime.src = toModuleUrl(payload.runtime);
	runtime.onload = () => {
		const modules = globalThis[${JSON.stringify(STORY_STANDALONE_RUNTIME_GLOBAL)}];
		const imports = {};
		for (const [specifier, namespace] of Object.entries(modules)) {
			imports[specifier] = toModuleUrl(shimSource(specifier, namespace));
		}
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports });
		document.head.append(importMap);

		globalThis.__naoStoryBoot = payload.boot;
		const boot = document.createElement('script');
		boot.type = 'module';
		boot.textContent = 'import { bootStory } from ' + JSON.stringify(${JSON.stringify(STORY_HOST_MODULE)}) + '; bootStory(globalThis.__naoStoryBoot);';
		document.body.append(boot);
	};
	document.body.append(runtime);
})();
`;
