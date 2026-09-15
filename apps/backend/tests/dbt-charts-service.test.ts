import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { extractBoardTitle, listProjectBoards, readProjectBoard } from '../src/services/dbt-charts-boards';
import { extractStorySummary } from '../src/utils/story-summary';

const projectFolders: string[] = [];

afterEach(() => {
	for (const folder of projectFolders) {
		rmSync(folder, { recursive: true, force: true });
	}
	projectFolders.length = 0;
});

describe('dbt charts project boards', () => {
	it('lists boards from every charts/ folder, skipping partials and non-YAML files', () => {
		const project = createProject();
		write(project, 'charts/revenue.yml', 'title: Revenue\ncharts: {}\n');
		write(project, 'charts/partials/kpis.yml', 'charts: {}\n');
		write(project, 'charts/notes.md', '# nope');
		write(project, 'dbt/charts/nested/orders.yaml', 'charts: {}\n');
		write(project, 'agent/charts/bubble.js', 'export function render() {}');
		write(project, 'dbt/target/charts/compiled.yml', 'title: ignored\n');

		expect(listProjectBoards(project).map(({ path, title }) => ({ path, title }))).toEqual([
			{ path: 'charts/revenue.yml', title: 'Revenue' },
			{ path: 'dbt/charts/nested/orders.yaml', title: 'Orders' },
		]);
	});

	it('reads a board by its project-relative path and refuses escapes', () => {
		const project = createProject();
		write(project, 'charts/revenue.yml', 'title: Revenue\n');
		const outside = mkdtempSync(join(tmpdir(), 'nao-outside-'));
		projectFolders.push(outside);
		writeFileSync(join(outside, 'secret.yml'), 'title: Secret\n');
		symlinkSync(join(outside, 'secret.yml'), join(project, 'charts', 'link.yml'));

		expect(readProjectBoard(project, 'charts/revenue.yml')).toMatchObject({
			path: 'charts/revenue.yml',
			title: 'Revenue',
			yaml: 'title: Revenue\n',
		});
		expect(readProjectBoard(project, 'charts/link.yml')).toBeNull();
		expect(readProjectBoard(project, '../secret.yml')).toBeNull();
		expect(readProjectBoard(project, 'charts/revenue.txt')).toBeNull();
	});

	it('falls back to a title derived from the file name', () => {
		expect(extractBoardTitle('not: [valid', 'charts/weekly_active-users.yml')).toBe('Weekly Active Users');
		expect(extractBoardTitle('charts: {}', 'charts/kpis.yaml')).toBe('Kpis');
	});
});

describe('dbt charts story summary', () => {
	it('summarises a board as one silhouette per chart', () => {
		const board = [
			'charts:',
			'  trend: { type: line, query: q, x: a, y: b, title: Trend }',
			'  total: { type: kpi, query: q, value: b, label: Total }',
			'  split: { type: donut, query: q, theta: b, color: a }',
			'  detail: { type: table, query: q, title: Detail }',
		].join('\n');

		expect(extractStorySummary(board, 'dbt_charts')).toEqual({
			segments: [
				{ type: 'chart', chartType: 'line', title: 'Trend' },
				{ type: 'chart', chartType: 'kpi_card', title: 'Total', kpiCount: 1 },
				{ type: 'chart', chartType: 'pie', title: '' },
				{ type: 'table', title: 'Detail' },
			],
		});
		expect(extractStorySummary('not: [yaml', 'dbt_charts')).toEqual({ segments: [] });
	});
});

function createProject(): string {
	const folder = mkdtempSync(join(tmpdir(), 'nao-dbt-charts-'));
	projectFolders.push(folder);
	return folder;
}

function write(project: string, relativePath: string, content: string): void {
	const filePath = join(project, ...relativePath.split('/'));
	mkdirSync(join(filePath, '..'), { recursive: true });
	writeFileSync(filePath, content);
}
