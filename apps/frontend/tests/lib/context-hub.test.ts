import { describe, expect, it } from 'vitest';
import type { FileTreeEntry } from '@nao/shared/types';

import {
	buildContextHubContent,
	findContextHubItem,
	findTableOfPath,
	formatTableLocation,
	groupTablesByLocation,
	isListedInContextHub,
	matchesContextHubDoc,
	matchesContextHubTable,
	toThumbnailLines,
} from '@/lib/context-hub';

const TABLE_FOLDER = '/databases/type=duckdb/database=shop/schema=main/table=orders';

describe('buildContextHubContent', () => {
	it('groups the files of each table and orders its pages', () => {
		const { tables } = buildContextHubContent(
			tree([
				`${TABLE_FOLDER}/preview.md`,
				`${TABLE_FOLDER}/columns.md`,
				`${TABLE_FOLDER}/custom_notes.md`,
				`${TABLE_FOLDER}/description.md`,
				`${TABLE_FOLDER}/annotations.md`,
			]),
		);

		expect(tables).toEqual([
			{
				key: 'databases/type=duckdb/database=shop/schema=main/table=orders',
				connection: 'duckdb',
				database: 'shop',
				schema: 'main',
				table: 'orders',
				files: [
					{ path: `${TABLE_FOLDER}/description.md`, label: 'Description' },
					{ path: `${TABLE_FOLDER}/annotations.md`, label: 'Notes' },
					{ path: `${TABLE_FOLDER}/columns.md`, label: 'Columns' },
					{ path: `${TABLE_FOLDER}/preview.md`, label: 'Preview' },
					{ path: `${TABLE_FOLDER}/custom_notes.md`, label: 'custom_notes' },
				],
			},
		]);
	});

	it.each([
		{ path: '/RULES.md', doc: { title: 'RULES', section: 'rules', folder: null } },
		{ path: '/docs/notion/onboarding.md', doc: { title: 'onboarding', section: 'docs', folder: 'notion' } },
		{ path: '/semantics/metrics/revenue.md', doc: { title: 'revenue', section: 'metrics', folder: 'metrics' } },
		{ path: '/agent/skills/top-customers.md', doc: { title: 'top-customers', section: 'skills', folder: null } },
	])('lists $path as a doc', ({ path, doc }) => {
		expect(buildContextHubContent(tree([path])).docs).toEqual([{ path, ...doc }]);
		expect(isListedInContextHub(path)).toBe(true);
	});

	it.each([
		'/tests/total_revenue.yml',
		'/agent/mcps/mcp.json',
		'/agent/charts/progress-bars.js',
		'/agent/skills/churn/query.sql',
		'/agent/skills/churn/SKILL.md',
		'/agent/skills/notes.txt',
		'/templates/databases/preview.md.j2',
		'/nao_config.yaml',
		'/docs/diagram.png',
		'/docs/notes.txt',
		'/README.md',
	])('leaves %s out of the hub', (path) => {
		expect(buildContextHubContent(tree([path]))).toEqual({ tables: [], docs: [] });
		expect(isListedInContextHub(path)).toBe(false);
	});
});

describe('Context Hub search', () => {
	const {
		tables: [orders],
		docs: [revenue],
	} = buildContextHubContent(tree([`${TABLE_FOLDER}/columns.md`, '/semantics/metrics/revenue.md']));

	it.each([
		{ query: 'ORD', expected: true },
		{ query: 'shop', expected: true },
		{ query: 'customers', expected: false },
		{ query: '  ', expected: true },
	])('matches the orders table with "$query": $expected', ({ query, expected }) => {
		expect(matchesContextHubTable(orders, query)).toBe(expected);
	});

	it.each([
		{ query: 'reven', expected: true },
		{ query: 'metrics', expected: true },
		{ query: 'orders', expected: false },
	])('matches the revenue doc with "$query": $expected', ({ query, expected }) => {
		expect(matchesContextHubDoc(revenue, query)).toBe(expected);
	});
});

describe('findTableOfPath', () => {
	const { tables } = buildContextHubContent(
		tree([`${TABLE_FOLDER}/columns.md`, `${TABLE_FOLDER}/annotations.md`, '/docs/orders.md']),
	);

	it.each([
		{ path: `${TABLE_FOLDER}/annotations.md`, expected: 'orders' },
		{ path: '/docs/orders.md', expected: null },
		{ path: null, expected: null },
	])('finds the table of $path', ({ path, expected }) => {
		expect(findTableOfPath(tables, path)?.table ?? null).toBe(expected);
	});

	it('names where a table lives', () => {
		expect(formatTableLocation(tables[0])).toBe('shop · main');
	});
});

describe('groupTablesByLocation', () => {
	it.each([
		{
			name: 'one unnamed folder when all tables share a connection and schema',
			folders: ['type=duckdb/database=shop/schema=main', 'type=duckdb/database=shop/schema=main'],
			expected: [{ label: null, tables: ['table_0', 'table_1'] }],
		},
		{
			name: 'a folder per schema, without the shared connection',
			folders: ['type=duckdb/database=shop/schema=main', 'type=duckdb/database=shop/schema=raw'],
			expected: [
				{ label: 'main', tables: ['table_0'] },
				{ label: 'raw', tables: ['table_1'] },
			],
		},
		{
			name: 'a folder per connection when the schema is shared',
			folders: ['type=duckdb/database=shop/schema=main', 'type=duckdb/database=crm/schema=main'],
			expected: [
				{ label: 'crm', tables: ['table_1'] },
				{ label: 'shop', tables: ['table_0'] },
			],
		},
		{
			name: 'a folder per connection and schema when both differ',
			folders: ['type=duckdb/database=shop/schema=main', 'type=duckdb/database=crm/schema=raw'],
			expected: [
				{ label: 'crm · raw', tables: ['table_1'] },
				{ label: 'shop · main', tables: ['table_0'] },
			],
		},
		{
			name: 'a folder per database type when the database and schema are shared',
			folders: ['type=duckdb/database=shop/schema=main', 'type=postgres/database=shop/schema=main'],
			expected: [
				{ label: 'duckdb', tables: ['table_0'] },
				{ label: 'postgres', tables: ['table_1'] },
			],
		},
	])('makes $name', ({ folders, expected }) => {
		const { tables } = buildContextHubContent(
			tree(folders.map((folder, index) => `/databases/${folder}/table=table_${index}/columns.md`)),
		);

		const grouped = groupTablesByLocation(tables, tables);

		expect(grouped.map((folder) => ({ ...folder, tables: folder.tables.map((table) => table.table) }))).toEqual(
			expected,
		);
	});

	it('names folders after every synced table, not only the ones a search kept', () => {
		const { tables } = buildContextHubContent(
			tree([
				'/databases/type=duckdb/database=shop/schema=main/table=orders/columns.md',
				'/databases/type=duckdb/database=shop/schema=raw/table=events/columns.md',
			]),
		);

		const grouped = groupTablesByLocation(
			tables.filter((table) => table.table === 'orders'),
			tables,
		);

		expect(grouped.map((folder) => folder.label)).toEqual(['main']);
	});
});

describe('findContextHubItem', () => {
	const content = buildContextHubContent(
		tree([`${TABLE_FOLDER}/columns.md`, '/docs/notion/onboarding.md', '/RULES.md', '/tests/revenue.yml']),
	);

	it.each([
		{
			path: `${TABLE_FOLDER}/columns.md`,
			expected: { title: 'orders', subtitle: 'Columns · shop · main', section: 'tables' },
		},
		{ path: '/docs/notion/onboarding.md', expected: { title: 'onboarding', subtitle: 'notion', section: 'docs' } },
		{ path: '/RULES.md', expected: { title: 'RULES', subtitle: null, section: 'rules' } },
		{ path: '/tests/revenue.yml', expected: null },
	])('lists $path in the hub as $expected', ({ path, expected }) => {
		expect(findContextHubItem(content, path)).toEqual(expected && { path, ...expected });
	});
});

describe('toThumbnailLines', () => {
	it('shows the text of the first lines without Markdown marks', () => {
		const excerpt = [
			'# Orders',
			'',
			'Use **net** amounts, see [the glossary](docs/glossary.md).',
			'```sql',
			'- `order_id` is unique',
			'| Column | Meaning |',
			'| --- | --- |',
			'> Refunds are negative.',
		].join('\n');

		expect(toThumbnailLines(excerpt)).toEqual([
			{ text: 'Orders', isHeading: true },
			{ text: 'Use net amounts, see the glossary.', isHeading: false },
			{ text: '• order_id is unique', isHeading: false },
			{ text: 'Column   Meaning', isHeading: false },
			{ text: 'Refunds are negative.', isHeading: false },
		]);
	});

	it('keeps the first lines up to the limit', () => {
		expect(toThumbnailLines('one\ntwo\nthree', 2).map((line) => line.text)).toEqual(['one', 'two']);
	});
});

/** A flat tree is enough: the hub reads files whatever folders hold them. */
function tree(paths: string[]): FileTreeEntry[] {
	return [
		{
			name: 'root',
			path: '/',
			type: 'directory',
			children: paths.map((path) => ({ name: path.split('/').at(-1) ?? path, path, type: 'file' })),
		},
	];
}
