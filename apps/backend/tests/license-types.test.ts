import { describe, expect, it } from 'vitest';

import { LICENSE_FEATURES } from '../src/types/license';

describe('license feature identifiers', () => {
	it('exposes separate row and column security features', () => {
		expect(LICENSE_FEATURES.rowLevelSecurity).toBe('row-level-security');
		expect(LICENSE_FEATURES.excludeColumns).toBe('exclude-columns');
	});
});
