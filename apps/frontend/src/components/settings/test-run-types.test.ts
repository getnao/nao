import { describe, expect, it } from 'vitest';

import { getContextChanges } from './test-run-types';
import type { DraftContext } from './test-run-types';

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
