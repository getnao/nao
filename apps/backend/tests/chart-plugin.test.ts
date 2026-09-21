import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listChartPlugins, readChartPlugin } from '../src/services/chart-plugin';

const projectFolders: string[] = [];

afterEach(() => {
	for (const folder of projectFolders) {
		rmSync(folder, { recursive: true, force: true });
	}
	projectFolders.length = 0;
});

describe('chart plugins', () => {
	it('discovers flat JavaScript modules with optional metadata', () => {
		const project = createProject();
		const chartsFolder = join(project, 'agent', 'charts');
		writeFileSync(join(chartsFolder, 'bubble.js'), 'export function render() {}');
		writeFileSync(
			join(chartsFolder, 'bubble.json'),
			JSON.stringify({ name: 'Bubble chart', description: 'Shows three numeric dimensions.' }),
		);
		writeFileSync(join(chartsFolder, 'progress-bars.mjs'), 'export function render() {}');

		expect(listChartPlugins(project)).toEqual([
			{
				type: 'bubble',
				name: 'Bubble chart',
				description: 'Shows three numeric dimensions.',
				version: expect.stringMatching(/^[a-f0-9]{16}$/),
			},
			{
				type: 'progress-bars',
				name: 'Progress Bars',
				description: '',
				version: expect.stringMatching(/^[a-f0-9]{16}$/),
			},
		]);
	});

	it('returns source and changes the version when source changes', () => {
		const project = createProject();
		const file = join(project, 'agent', 'charts', 'bubble.js');
		writeFileSync(file, 'export function render() { return 1; }');

		const first = readChartPlugin(project, 'bubble');
		writeFileSync(file, 'export function render() { return 2; }');
		const second = readChartPlugin(project, 'bubble');

		expect(first?.source).toContain('return 1');
		expect(second?.source).toContain('return 2');
		expect(second?.entry.version).not.toBe(first?.entry.version);
	});

	it('ignores built-ins, duplicate types, nested files, and symlinks', () => {
		const project = createProject();
		const chartsFolder = join(project, 'agent', 'charts');
		const outsideFile = join(project, 'outside.js');
		writeFileSync(join(chartsFolder, 'bar.js'), 'export function render() {}');
		writeFileSync(join(chartsFolder, 'duplicate.js'), 'export function render() {}');
		writeFileSync(join(chartsFolder, 'duplicate.mjs'), 'export function render() {}');
		writeFileSync(outsideFile, 'secret');
		symlinkSync(outsideFile, join(chartsFolder, 'linked.js'));
		mkdirSync(join(chartsFolder, 'nested'));
		writeFileSync(join(chartsFolder, 'nested', 'nested.js'), 'export function render() {}');

		expect(listChartPlugins(project)).toEqual([]);
	});

	it('rejects a charts directory that links outside the project', () => {
		const project = createProject(false);
		const outside = createProject();
		const agentFolder = join(project, 'agent');
		mkdirSync(agentFolder, { recursive: true });
		symlinkSync(join(outside, 'agent', 'charts'), join(agentFolder, 'charts'));
		writeFileSync(join(outside, 'agent', 'charts', 'leak.js'), 'export function render() {}');

		expect(listChartPlugins(project)).toEqual([]);
	});

	it('keeps project discovery isolated without shared state', () => {
		const firstProject = createProject();
		const secondProject = createProject();
		writeFileSync(join(firstProject, 'agent', 'charts', 'first.js'), 'export function render() {}');
		writeFileSync(join(secondProject, 'agent', 'charts', 'second.js'), 'export function render() {}');

		expect(listChartPlugins(firstProject).map((plugin) => plugin.type)).toEqual(['first']);
		expect(listChartPlugins(secondProject).map((plugin) => plugin.type)).toEqual(['second']);
	});
});

function createProject(withChartsFolder = true): string {
	const project = mkdtempSync(join(tmpdir(), 'nao-chart-plugin-'));
	projectFolders.push(project);
	if (withChartsFolder) {
		mkdirSync(join(project, 'agent', 'charts'), { recursive: true });
	}
	return project;
}
