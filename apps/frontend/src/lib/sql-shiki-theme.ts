import { shikiToMonaco } from '@shikijs/monaco';
import sql from '@shikijs/langs/sql';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { Monaco } from '@monaco-editor/react';
import type { HighlighterCore, ThemeRegistration } from 'shiki/core';

export const SQL_SHIKI_THEME = { light: 'nao-sql-light', dark: 'nao-sql-dark' } as const;

const TRANSPARENT = '#00000000';

let highlighterPromise: Promise<HighlighterCore> | null = null;
let setupPromise: Promise<void> | null = null;

export function setupSqlHighlighting(monaco: Monaco): Promise<void> {
	setupPromise ??= loadSqlHighlighter().then((highlighter) => shikiToMonaco(highlighter, monaco));
	return setupPromise;
}

/** The SQL highlighter shared by the SQL editor and the read-only SQL views, created on first use. */
export function loadSqlHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		themes: [
			withTransparentBackground(githubLight, SQL_SHIKI_THEME.light),
			withTransparentBackground(githubDark, SQL_SHIKI_THEME.dark),
		],
		langs: [sql],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}

function withTransparentBackground(theme: ThemeRegistration, name: string): ThemeRegistration {
	return {
		...theme,
		name,
		colors: {
			...theme.colors,
			'editor.background': TRANSPARENT,
			'editorGutter.background': TRANSPARENT,
			'minimap.background': TRANSPARENT,
		},
	};
}
