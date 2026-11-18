import { describe, expect, it } from 'vitest';

import { fromExplorerTestPath, isTestFilePath, toExplorerTestPath, toTestPath } from '../src/test-paths';

describe('toTestPath', () => {
	it.each([
		['/tests/revenue.yml', 'revenue.yml'],
		['tests/sales/orders.yaml', 'sales/orders.yaml'],
		['\\tests\\sales\\orders.yml', 'sales/orders.yml'],
		['/tests/outputs/results.yml', null],
		['/tests/notes.md', null],
		['/tests/revenue.YML', null],
		['/tests.yml', null],
		['/semantics/revenue.yml', null],
		['/tests/../nao_config.yaml', null],
	])('maps %s to %s', (projectPath, expected) => {
		expect(toTestPath(projectPath)).toBe(expected);
		expect(isTestFilePath(projectPath)).toBe(expected !== null);
	});
});

describe('explorer test paths', () => {
	it('round-trips a test path through its explorer path', () => {
		expect(toExplorerTestPath('sales/orders.yml')).toBe('/tests/sales/orders.yml');
		expect(fromExplorerTestPath('/tests/sales/orders.yml')).toBe('sales/orders.yml');
		expect(fromExplorerTestPath('tests/sales/orders.yml')).toBe('sales/orders.yml');
	});
});
