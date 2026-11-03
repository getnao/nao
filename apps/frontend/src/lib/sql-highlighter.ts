import sql from '@shikijs/langs/sql';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlighterCore } from 'shiki/core';

export interface SqlToken {
	content: string;
	/** The `--shiki-light` and `--shiki-dark` colors of the token. */
	style: Record<string, string>;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;

/** Splits SQL into lines of colored tokens, so that each line can be styled on its own, as in a diff. */
export async function tokenizeSql(code: string): Promise<SqlToken[][]> {
	const highlighter = await loadHighlighter();
	const { tokens } = highlighter.codeToTokens(code, {
		lang: 'sql',
		themes: { light: 'github-light', dark: 'github-dark' },
		defaultColor: false,
	});
	return tokens.map((line) => line.map((token) => ({ content: token.content, style: token.htmlStyle ?? {} })));
}

function loadHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		themes: [githubLight, githubDark],
		langs: [sql],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}
