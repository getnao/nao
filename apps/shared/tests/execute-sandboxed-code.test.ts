import { describe, expect, it } from 'vitest';

import { saveFileSchema } from '../src/tools/execute-sandboxed-code';

describe('saveFileSchema', () => {
	it('accepts a file name but rejects paths and traversal segments', () => {
		expect(saveFileSchema.safeParse({ filename: 'report.xlsx', home_path: '/home/report.xlsx' }).success).toBe(
			true,
		);

		for (const filename of ['', '../report.xlsx', 'nested/report.xlsx', 'nested\\report.xlsx', '.', '..']) {
			expect(saveFileSchema.safeParse({ filename, home_path: '/home/report.xlsx' }).success).toBe(false);
		}
	});
});
