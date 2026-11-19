import { describe, expect, it } from 'vitest';

import { sanitizeCommitMessage } from '../../src/services/context-commit-message.service';

describe('sanitizeCommitMessage', () => {
	it.each([
		{ text: 'Document net revenue on orders', expected: 'Document net revenue on orders' },
		{ text: '"Document net revenue on orders."', expected: 'Document net revenue on orders' },
		{ text: 'Document refunds\n\nThe orders table now explains refunds.', expected: 'Document refunds' },
		{ text: `  ${'x'.repeat(200)}  `, expected: 'x'.repeat(120) },
	])('keeps one clean line from $text', ({ text, expected }) => {
		expect(sanitizeCommitMessage(text)).toBe(expected);
	});
});
