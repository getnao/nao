export const SQL_QUERY_TAG_VARIABLES = {
	user_id: 'Id of the user the query runs for.',
	user_email: 'Email of that user.',
	user_groups: 'Names of the user groups of that user, separated by commas.',
	project_id: 'Id of the nao project.',
	chat_id: 'Id of the chat the query belongs to, empty outside of a chat.',
	source: 'Where the query comes from: web, slack, teams, automation, mcp, story, sqlEditor…',
	database_id: 'Name in nao_config.yaml of the database the query runs on.',
} as const;

export type SqlQueryTagVariable = keyof typeof SQL_QUERY_TAG_VARIABLES;
export type SqlQueryTagVariables = Record<SqlQueryTagVariable, string>;

export const SQL_QUERY_TAG_POSITIONS = ['start', 'end'] as const;
export type SqlQueryTagPosition = (typeof SQL_QUERY_TAG_POSITIONS)[number];

export const DEFAULT_SQL_QUERY_TAG_POSITION: SqlQueryTagPosition = 'start';
export const DEFAULT_SQL_QUERY_TAG_TEMPLATE =
	'nao: user_email={{ user_email }}, user_groups={{ user_groups }}, project_id={{ project_id }}, chat_id={{ chat_id }}, source={{ source }}';
export const SQL_QUERY_TAG_TEMPLATE_MAX_LENGTH = 1000;

export interface SqlQueryTagConfig {
	template: string;
	position: SqlQueryTagPosition;
}

const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;
const CONTROL_CHARACTERS = /\p{Cc}+/gu;
const CONTROL_CHARACTERS_BUT_NEWLINE = /[^\P{Cc}\n]+/gu;

/**
 * The text of the comment tagging a query. Values cannot span lines, and nothing in the text can close
 * the comment or open a nested one, so a value such as a group name never ends up running as SQL.
 */
export function renderSqlQueryTag(template: string, variables: SqlQueryTagVariables): string {
	const text = template.replace(PLACEHOLDER_PATTERN, (placeholder, name: string) => {
		return isSqlQueryTagVariable(name) ? variables[name].replace(CONTROL_CHARACTERS, ' ') : placeholder;
	});
	return text.replace(CONTROL_CHARACTERS_BUT_NEWLINE, ' ').replaceAll('*/', '* /').replaceAll('/*', '/ *').trim();
}

/** The space after the opening delimiter keeps the text from reading as a hint or as MySQL executable code. */
export function formatSqlQueryTagComment(text: string): string {
	return `/* ${text} */`;
}

export function findUnknownSqlQueryTagVariables(template: string): string[] {
	const names = [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
	return [...new Set(names.filter((name) => !isSqlQueryTagVariable(name)))];
}

export function isSqlQueryTagPosition(value: unknown): value is SqlQueryTagPosition {
	return SQL_QUERY_TAG_POSITIONS.some((position) => position === value);
}

function isSqlQueryTagVariable(name: string): name is SqlQueryTagVariable {
	return Object.hasOwn(SQL_QUERY_TAG_VARIABLES, name);
}
