import { describe, expect, it } from 'vitest';

import { computeLineDiff } from './line-diff';

describe('computeLineDiff', () => {
	it('computes a line-aware diff for small inputs', () => {
		const diff = computeLineDiff('a\nb\nc', 'a\nx\nc');

		expect(diff).toEqual({
			additions: 1,
			deletions: 1,
			lines: [
				{ type: 'context', text: 'a', oldNumber: 1, newNumber: 1 },
				{ type: 'remove', text: 'b', oldNumber: 2, newNumber: null },
				{ type: 'add', text: 'x', oldNumber: null, newNumber: 2 },
				{ type: 'context', text: 'c', oldNumber: 3, newNumber: 3 },
			],
		});
	});

	it('treats CRLF and LF line endings as the same content', () => {
		const diff = computeLineDiff('a\r\nb\r\nc', 'a\nb\nc');

		expect(diff).toEqual({
			additions: 0,
			deletions: 0,
			lines: [
				{ type: 'context', text: 'a', oldNumber: 1, newNumber: 1 },
				{ type: 'context', text: 'b', oldNumber: 2, newNumber: 2 },
				{ type: 'context', text: 'c', oldNumber: 3, newNumber: 3 },
			],
		});
	});

	it('falls back when the quadratic DP table would exceed the budget', () => {
		const oldText = makeLines('old', 1000);
		const newText = makeLines('new', 1000);

		const diff = computeLineDiff(oldText, newText);

		expect(diff.additions).toBe(1000);
		expect(diff.deletions).toBe(1000);
		expect(diff.lines).toHaveLength(2000);
		expect(diff.lines.every((line) => line.type !== 'context')).toBe(true);
		expect(diff.lines[999]).toEqual({ type: 'remove', text: 'old-999', oldNumber: 1000, newNumber: null });
		expect(diff.lines[1000]).toEqual({ type: 'add', text: 'new-0', oldNumber: null, newNumber: 1 });
	});
});

function makeLines(prefix: string, count: number): string {
	return Array.from({ length: count }, (_, index) => `${prefix}-${index}`).join('\n');
}
