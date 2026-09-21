import { shikiToMonaco } from '@shikijs/monaco';
import sql from '@shikijs/langs/sql';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import type { Monaco } from '@monaco-editor/react';
import type { ThemeRegistration } from 'shiki/core';

export const SQL_SHIKI_THEME = { light: 'nao-sql-light', dark: 'nao-sql-dark' } as const;

const TRANSPARENT = '#00000000';

let setupPromise: Promise<void> | null = null;

export function setupSqlHighlighting(monaco: Monaco): Promise<void> {
	if (!setupPromise) {
		setupPromise = registerSqlThemes(monaco);
	}
	return setupPromise;
}

async function registerSqlThemes(monaco: Monaco): Promise<void> {
	const highlighter = await createHighlighterCore({
		themes: [
			withTransparentBackground(githubLight, SQL_SHIKI_THEME.light),
			withTransparentBackground(githubDark, SQL_SHIKI_THEME.dark),
		],
		langs: [sql],
		engine: createOnigurumaEngine(import('shiki/wasm')),
	});
	shikiToMonaco(highlighter, monaco);
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
