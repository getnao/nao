import { describe, expect, it, vi } from 'vitest';

import { findFileReferenceAt } from '@/hooks/use-file-reference-links';

describe('findFileReferenceAt', () => {
	it.each([
		{
			line: '    from_file: repos/business/tables.yml',
			column: 20,
			opened: '/repos/business/tables.yml',
			start: 16,
		},
		{ line: '  include: { from_file: "./tables.yml" }', column: 30, opened: '/tables.yml', start: 26 },
		{ line: "  from_file: 'tables.yml' # analysts' list", column: 16, opened: '/tables.yml', start: 15 },
	])('opens $opened from the path under the pointer', ({ line, column, opened, start }) => {
		const onOpenFile = vi.fn();

		const link = findFileReferenceAt(line, 3, column, onOpenFile);
		link?.follow();

		expect(link?.range).toMatchObject({ startLineNumber: 3, startColumn: start });
		expect(onOpenFile).toHaveBeenCalledWith(opened);
	});

	it.each([
		{ line: '    from_file: repos/business/tables.yml', column: 6 },
		{ line: '    path: ./jaffle_shop.duckdb', column: 15 },
	])('finds no link off a from_file path ($line at $column)', ({ line, column }) => {
		expect(findFileReferenceAt(line, 1, column, vi.fn())).toBeNull();
	});
});
