import type { FileTreeEntry } from '@nao/shared/types';

export interface ContextHubTable {
	key: string;
	connection: string | null;
	database: string | null;
	schema: string | null;
	table: string;
	files: ContextHubTableFile[];
}

export interface ContextHubTableFile {
	path: string;
	label: string;
}

export type ContextHubDocSection = 'rules' | 'docs' | 'metrics' | 'skills';

export type ContextHubSection = 'tables' | ContextHubDocSection;

export interface ContextHubDoc {
	path: string;
	title: string;
	section: ContextHubDocSection;
	folder: string | null;
}

export interface ContextHubTableFolder {
	/** The location parts that tell this folder apart from the others, or null when all tables share one place. */
	label: string | null;
	tables: ContextHubTable[];
}

export interface ContextHubContent {
	tables: ContextHubTable[];
	docs: ContextHubDoc[];
}

/** A file as the hub lists it: a doc, or the page of a table. */
export interface ContextHubItem {
	path: string;
	title: string;
	subtitle: string | null;
	section: ContextHubSection;
}

export interface ThumbnailLine {
	text: string;
	isHeading: boolean;
}

export const CONTEXT_HUB_DOC_SECTIONS: ReadonlyArray<{ key: ContextHubDocSection; label: string }> = [
	{ key: 'rules', label: 'Agent rules' },
	{ key: 'docs', label: 'Docs' },
	{ key: 'metrics', label: 'Metrics & definitions' },
	{ key: 'skills', label: 'Skills' },
];

const TABLE_LOCATION_PARTS: ReadonlyArray<(table: ContextHubTable) => string | null> = [
	(table) => table.connection,
	(table) => table.database,
	(table) => table.schema,
];
const UNNAMED_TABLE_FOLDER = 'Other';
const TABLE_FILE_ORDER = ['description', 'annotations', 'columns', 'preview', 'profiling'];
const TABLE_FILE_LABELS: Record<string, string> = {
	description: 'Description',
	annotations: 'Notes',
	columns: 'Columns',
	preview: 'Preview',
	profiling: 'Profiling',
};
const DOC_EXTENSIONS = /\.(md|mdx|markdown)$/i;
const TABLE_DIVIDER_PATTERN = /^\|?\s*:?-{3,}/;

/**
 * Keeps the part of the context people who do not work with files care about: the synced tables and the
 * written docs, rules, metrics and skills. Tests, MCP servers, templates and config files are left out.
 */
export function buildContextHubContent(entries: readonly FileTreeEntry[]): ContextHubContent {
	const filePaths = listFilePaths(entries).map(toProjectPath);
	return {
		tables: groupTableFiles(filePaths),
		docs: filePaths.flatMap((path) => {
			const doc = toContextHubDoc(path);
			return doc ? [doc] : [];
		}),
	};
}

/** Whether the doc view lists the file, as a doc or as the page of a table. */
export function isListedInContextHub(path: string): boolean {
	const projectPath = toProjectPath(path);
	return toContextHubDoc(projectPath) !== null || parseTableFilePath(projectPath) !== null;
}

export function formatTableLocation(table: ContextHubTable): string {
	return [table.database ?? table.connection, table.schema].filter(Boolean).join(' · ');
}

/**
 * Splits the tables into one folder per place they live in, named only by the location parts that differ across all
 * the synced tables. When every table shares one connection and schema, they stay in a single unnamed folder.
 */
export function groupTablesByLocation(
	tables: readonly ContextHubTable[],
	allTables: readonly ContextHubTable[],
): ContextHubTableFolder[] {
	const varyingParts = TABLE_LOCATION_PARTS.filter((getPart) => new Set(allTables.map(getPart)).size > 1);
	if (varyingParts.length === 0) {
		return tables.length > 0 ? [{ label: null, tables: [...tables] }] : [];
	}
	const tablesByLabel = new Map<string, ContextHubTable[]>();
	for (const table of tables) {
		const label =
			varyingParts
				.map((getPart) => getPart(table))
				.filter(Boolean)
				.join(' · ') || UNNAMED_TABLE_FOLDER;
		tablesByLabel.set(label, [...(tablesByLabel.get(label) ?? []), table]);
	}
	return [...tablesByLabel]
		.map(([label, folderTables]) => ({ label, tables: folderTables }))
		.sort((left, right) => left.label.localeCompare(right.label));
}

export function findTableOfPath(tables: readonly ContextHubTable[], path: string | null): ContextHubTable | null {
	return path ? (tables.find((table) => table.files.some((file) => file.path === path)) ?? null) : null;
}

export function findContextHubItem(content: ContextHubContent, path: string): ContextHubItem | null {
	const doc = content.docs.find((candidate) => candidate.path === path);
	if (doc) {
		return { path, title: doc.title, subtitle: doc.folder, section: doc.section };
	}
	const table = findTableOfPath(content.tables, path);
	const page = table?.files.find((file) => file.path === path);
	if (!table || !page) {
		return null;
	}
	const subtitle = [page.label, formatTableLocation(table)].filter(Boolean).join(' · ');
	return { path, title: table.table, subtitle, section: 'tables' };
}

/** The first lines of a file's text as its thumbnail shows them, without the Markdown marks. */
export function toThumbnailLines(excerpt: string, limit = 12): ThumbnailLine[] {
	return excerpt
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('```') && !TABLE_DIVIDER_PATTERN.test(line))
		.slice(0, limit)
		.map((line) => ({ text: stripMarkdownMarks(line), isHeading: line.startsWith('#') }));
}

export function matchesContextHubTable(table: ContextHubTable, query: string): boolean {
	return matchesQuery([table.table, table.schema, table.database, table.connection], query);
}

export function matchesContextHubDoc(doc: ContextHubDoc, query: string): boolean {
	return matchesQuery([doc.title, doc.folder, doc.path], query);
}

function groupTableFiles(filePaths: readonly string[]): ContextHubTable[] {
	const tablesByKey = new Map<string, ContextHubTable>();
	for (const path of filePaths) {
		const location = parseTableFilePath(path);
		if (!location) {
			continue;
		}
		const table = tablesByKey.get(location.table.key) ?? { ...location.table, files: [] };
		table.files.push({ path: toExplorerPath(path), label: getTableFileLabel(location.fileName) });
		tablesByKey.set(table.key, table);
	}
	return [...tablesByKey.values()]
		.map((table) => ({ ...table, files: table.files.sort(compareTableFiles) }))
		.sort(compareTables);
}

/** A table file looks like `databases/type=duckdb/database=shop/schema=main/table=orders/columns.md`. */
function parseTableFilePath(path: string): { fileName: string; table: Omit<ContextHubTable, 'files'> } | null {
	const segments = path.split('/');
	const fileName = segments.at(-1);
	const tableSegmentIndex = segments.length - 2;
	if (segments[0] !== 'databases' || !fileName || !DOC_EXTENSIONS.test(fileName) || tableSegmentIndex < 1) {
		return null;
	}
	const properties = new Map(segments.slice(1, -1).map(parseKeyValueSegment).filter(isPresent));
	const table = properties.get('table');
	if (!table || !segments[tableSegmentIndex].startsWith('table=')) {
		return null;
	}
	return {
		fileName,
		table: {
			key: segments.slice(0, -1).join('/'),
			connection: properties.get('type') ?? null,
			database: properties.get('database') ?? null,
			schema: properties.get('schema') ?? null,
			table,
		},
	};
}

function toContextHubDoc(path: string): ContextHubDoc | null {
	if (path === 'RULES.md') {
		return { path: toExplorerPath(path), title: 'RULES', section: 'rules', folder: null };
	}
	if (!DOC_EXTENSIONS.test(path)) {
		return null;
	}
	if (path.startsWith('docs/')) {
		return toFolderDoc(path, 'docs/', 'docs');
	}
	if (path.startsWith('semantics/')) {
		return toFolderDoc(path, 'semantics/', 'metrics');
	}
	if (path.startsWith('agent/skills/')) {
		return toSkillDoc(path);
	}
	return null;
}

function toFolderDoc(path: string, root: string, section: ContextHubDocSection): ContextHubDoc {
	const segments = path.slice(root.length).split('/');
	const fileName = segments.at(-1) ?? path;
	const folder = segments.slice(0, -1).join('/');
	return { path: toExplorerPath(path), title: stripExtension(fileName), section, folder: folder || null };
}

/** Only the Markdown files right under `agent/skills/` are loaded by the agent, so they are the only skills listed. */
function toSkillDoc(path: string): ContextHubDoc | null {
	const segments = path.slice('agent/skills/'.length).split('/');
	if (segments.length !== 1 || !segments[0].endsWith('.md')) {
		return null;
	}
	return { path: toExplorerPath(path), title: stripExtension(segments[0]), section: 'skills', folder: null };
}

function listFilePaths(entries: readonly FileTreeEntry[]): string[] {
	return entries.flatMap((entry) =>
		entry.type === 'directory' ? listFilePaths(entry.children ?? []) : [entry.path],
	);
}

function getTableFileLabel(fileName: string): string {
	const name = stripExtension(fileName);
	return TABLE_FILE_LABELS[name] ?? name;
}

function compareTableFiles(left: ContextHubTableFile, right: ContextHubTableFile): number {
	return tableFileRank(left) - tableFileRank(right) || left.label.localeCompare(right.label);
}

function tableFileRank(file: ContextHubTableFile): number {
	const name = stripExtension(file.path.split('/').at(-1) ?? '');
	const rank = TABLE_FILE_ORDER.indexOf(name);
	return rank === -1 ? TABLE_FILE_ORDER.length : rank;
}

function compareTables(left: ContextHubTable, right: ContextHubTable): number {
	return (
		(left.database ?? '').localeCompare(right.database ?? '') ||
		(left.schema ?? '').localeCompare(right.schema ?? '') ||
		left.table.localeCompare(right.table)
	);
}

function parseKeyValueSegment(segment: string): [string, string] | null {
	const separatorIndex = segment.indexOf('=');
	return separatorIndex > 0 ? [segment.slice(0, separatorIndex), segment.slice(separatorIndex + 1)] : null;
}

function stripMarkdownMarks(line: string): string {
	return line
		.replace(/^#+\s*/, '')
		.replace(/^(?:[-*+]|\d+\.)\s+/, '• ')
		.replace(/^>\s*/, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
		.replace(/^\||\|$/g, '')
		.replace(/\s*\|\s*/g, '   ')
		.trim();
}

function matchesQuery(values: ReadonlyArray<string | null>, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	return (
		normalizedQuery.length === 0 || values.some((value) => value?.toLowerCase().includes(normalizedQuery) === true)
	);
}

function stripExtension(fileName: string): string {
	return fileName.replace(/\.[^.]+$/, '');
}

function toProjectPath(path: string): string {
	return path.replace(/^\/+/, '');
}

function toExplorerPath(path: string): string {
	return `/${path}`;
}

function isPresent<Value>(value: Value | null): value is Value {
	return value !== null;
}
