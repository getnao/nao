import { describe, expect, it } from 'vitest';

import { normalizeWindowsDescriptorPath } from '../src/agents/tools/windows-descriptor-path';

describe('Windows descriptor path normalization', () => {
	it('normalizes extended drive paths', () => {
		expect(normalizeWindowsDescriptorPath('\\\\?\\C:\\project\\notes.md')).toBe('C:\\project\\notes.md');
	});

	it('normalizes extended UNC paths', () => {
		expect(normalizeWindowsDescriptorPath('\\\\?\\UNC\\server\\share\\notes.md')).toBe(
			'\\\\server\\share\\notes.md',
		);
	});
});
