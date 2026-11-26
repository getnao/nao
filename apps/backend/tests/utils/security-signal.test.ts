import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PathEscapeError, UnsafeUrlError } from '../../src/utils/security-errors';
import { findSecuritySignal, reportSecuritySignalOfError } from '../../src/utils/security-signal';
import { logger } from '../helpers/logger-mock';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const UNSAFE_URL = new UnsafeUrlError('Access to private address "169.254.169.254" is not allowed.', '169.254.169.254');
const PATH_ESCAPE = new PathEscapeError("Access denied: path '../../.env' is outside the project folder", '../../.env');

describe('findSecuritySignal', () => {
	it.each([
		{
			error: new TRPCError({ code: 'NOT_FOUND', message: 'No procedure found on path "user.me"' }),
			expected: { signal: 'unknown-procedure', detail: 'user.me' },
		},
		{
			error: new TRPCError({ code: 'METHOD_NOT_SUPPORTED', message: 'Unsupported GET-request to mutation' }),
			expected: { signal: 'unknown-procedure', detail: 'user.me' },
		},
		{ error: UNSAFE_URL, expected: { signal: 'ssrf-blocked', detail: '169.254.169.254' } },
		{
			error: new TRPCError({ code: 'FORBIDDEN', message: PATH_ESCAPE.message, cause: PATH_ESCAPE }),
			expected: { signal: 'path-escape', detail: '../../.env' },
		},
	])('finds $expected.signal in $error.message', ({ error, expected }) => {
		expect(findSecuritySignal(error, 'user.me')).toEqual(expected);
	});

	it.each([
		new TRPCError({ code: 'NOT_FOUND', message: 'Chat with id 1234 not found.' }),
		new Error('Failed to fetch URL: The operation was aborted'),
		'not an error',
	])('finds nothing in an ordinary failure: %s', (error) => {
		expect(findSecuritySignal(error, 'chat.get')).toBeNull();
	});
});

describe('reportSecuritySignalOfError', () => {
	beforeEach(() => {
		logger.warn.mockClear();
	});

	it('logs the signal under the security source, with the user', () => {
		reportSecuritySignalOfError(UNSAFE_URL, { userId: 'user-1' });

		expect(logger.warn).toHaveBeenCalledWith('Security signal ssrf-blocked: 169.254.169.254', {
			source: 'security',
			userId: 'user-1',
			projectId: undefined,
			context: { signal: 'ssrf-blocked', detail: '169.254.169.254' },
		});
	});

	it('logs nothing for an ordinary failure', () => {
		reportSecuritySignalOfError(new Error('boom'), { userId: 'user-1' });

		expect(logger.warn).not.toHaveBeenCalled();
	});
});
