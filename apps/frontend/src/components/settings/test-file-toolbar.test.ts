import { describe, expect, it, vi } from 'vitest';

import { isTestFilePath } from './test-file-toolbar';

vi.mock('@/main', () => ({ trpc: {} }));

describe('isTestFilePath', () => {
	it.each([
		['/tests/revenue.yml', true],
		['/tests/sales/orders.yaml', true],
		['/tests/outputs/results_1.yml', false],
		['/tests/readme.md', false],
		['/tests.yml', false],
		['/semantics/revenue.yml', false],
	])('detects %s as %s', (filePath, expected) => {
		expect(isTestFilePath(filePath)).toBe(expected);
	});
});
