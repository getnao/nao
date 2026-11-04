import { loadSqlHighlighter, SQL_SHIKI_THEME } from '@/lib/sql-shiki-theme';

export interface SqlToken {
	content: string;
	/** The `--shiki-light` and `--shiki-dark` colors of the token. */
	style: Record<string, string>;
}

/** Splits SQL into lines of colored tokens, so that each line can be styled on its own, as in a diff. */
export async function tokenizeSql(code: string): Promise<SqlToken[][]> {
	const highlighter = await loadSqlHighlighter();
	const { tokens } = highlighter.codeToTokens(code, { lang: 'sql', themes: SQL_SHIKI_THEME, defaultColor: false });
	return tokens.map((line) => line.map((token) => ({ content: token.content, style: token.htmlStyle ?? {} })));
}
