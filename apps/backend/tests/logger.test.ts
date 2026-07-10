import { describe, expect, it, vi } from 'vitest';

import { serializeError } from '../src/utils/logger';

vi.mock('../src/db/db', () => ({ db: {} }));

describe('serializeError', () => {
	it('redacts credentials embedded in a URL within the error message', () => {
		const error = new Error(
			'Command failed: git clone --depth 1 https://oauth2:gl-abc123token@gitlab.com/nao/context.git /tmp/dir',
		);
		const serialized = serializeError(error);
		expect(serialized.message).not.toContain('gl-abc123token');
		expect(serialized.message).toBe(
			'Command failed: git clone --depth 1 https://***@gitlab.com/nao/context.git /tmp/dir',
		);
	});

	it('redacts credentials embedded in the stack trace', () => {
		const error = new Error('boom');
		error.stack = 'Error: boom\n    at https://oauth2:secret-token@gitlab.com/nao/context.git:1:1';
		const serialized = serializeError(error);
		expect(serialized.stack).not.toContain('secret-token');
	});

	it('leaves messages without embedded credentials untouched', () => {
		const error = new Error('GitLab API error: 500');
		expect(serializeError(error)).toEqual({
			name: 'Error',
			message: 'GitLab API error: 500',
			stack: error.stack,
		});
	});

	it('redacts non-Error values that stringify to a credentialed URL', () => {
		const serialized = serializeError('failed at https://user:pw@example.com/path');
		expect(serialized.value).toBe('failed at https://***@example.com/path');
	});
});
