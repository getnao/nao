import { describe, expect, it } from 'vitest';

import { getContextChanges, isTestFilePath } from './test-run-types';
import type { DraftContext } from './test-run-types';

describe('isTestFilePath', () => {
	it.each([
		['/tests/revenue.yml', true],
		['/tests/sales/orders.yaml', true],
		['/tests/outputs/results_1.yml', false],
		['/tests/readme.md', false],
		['/tests.yml', false],
		['/semantics/revenue.yml', false],
		['tests/revenue.yml', true],
		['\\tests\\sales\\orders.yml', true],
		['/tests/revenue.YML', false],
	])('detects %s as %s', (filePath, expected) => {
		expect(isTestFilePath(filePath)).toBe(expected);
	});
});

describe('getContextChanges', () => {
	it('leaves out the edited tests, which run the same on production and on the draft', () => {
		const draft = {
			changes: [
				{ path: 'RULES.md', kind: 'modified' },
				{ path: 'tests/revenue.yml', kind: 'added' },
			],
		} as DraftContext;

		expect(getContextChanges(draft)).toEqual([{ path: 'RULES.md', kind: 'modified' }]);
		expect(getContextChanges(null)).toEqual([]);
	});
});
