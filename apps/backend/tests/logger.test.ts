import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as logQueries from '../src/queries/log.queries';
import { logger, sanitizeLogText, serializeError } from '../src/utils/logger';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/log.queries', () => ({ insertLog: vi.fn(async () => undefined) }));

describe('serializeError', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

	it('redacts authorization values and private keys', () => {
		const value =
			'Authorization: Bearer token-value\n-----BEGIN PRIVATE KEY-----\nprivate-key\n-----END PRIVATE KEY-----';

		expect(sanitizeLogText(value)).toBe('Authorization: [REDACTED]\n[REDACTED PRIVATE KEY]');
	});

	it.each([
		'client_secret',
		'clientSecret',
		'refresh_token',
		'refreshToken',
		'auth_token',
		'authToken',
		'access_token',
		'access-token',
		'accessToken',
		'api_key',
		'api-key',
		'apiKey',
	])('redacts the %s query parameter', (key) => {
		expect(sanitizeLogText(`https://example.com/callback?${key}=secret-value&safe=visible`)).toBe(
			`https://example.com/callback?${key}=[REDACTED]&safe=visible`,
		);
	});

	it.each([
		['{"Authorization":"abc123def"}', '{"Authorization":"[REDACTED]"}'],
		["{'Authorization':'abc123def'}", "{'Authorization':'[REDACTED]'}"],
	])('redacts quoted authorization values', (value, expected) => {
		expect(sanitizeLogText(value)).toBe(expected);
	});

	it('redacts GitHub fine-grained personal access tokens', () => {
		const token = `github_pat_${'a1_'.repeat(8)}`;
		expect(sanitizeLogText(`GitHub rejected ${token}`)).toBe('GitHub rejected [REDACTED]');
	});

	it('only redacts bearer values that look like credentials', () => {
		expect(sanitizeLogText('Bearer tokens must be stored safely')).toBe('Bearer tokens must be stored safely');
		expect(sanitizeLogText('Authorization failed for Bearer secret-token')).toBe(
			'Authorization failed for Bearer [REDACTED]',
		);
		expect(sanitizeLogText(`Bearer ${'a'.repeat(24)}`)).toBe('Bearer [REDACTED]');
	});

	it('sanitizes logger messages and context before persistence', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const context: Record<string, unknown> = {
			token: 'context-secret',
			url: 'https://oauth2:nested-secret@gitlab.com/nao/context.git',
		};
		const items: unknown[] = [context];
		context.items = items;
		items.push(items);

		logger.error('Clone failed at https://oauth2:secret-token@gitlab.com/nao/context.git', {
			source: 'agent',
			projectId: 'project-1',
			context,
		});

		expect(consoleError).toHaveBeenCalledWith(
			'[ERROR] [agent] Clone failed at https://***@gitlab.com/nao/context.git',
		);
		await vi.waitFor(() => {
			expect(logQueries.insertLog).toHaveBeenCalledWith({
				level: 'error',
				message: 'Clone failed at https://***@gitlab.com/nao/context.git',
				source: 'agent',
				projectId: 'project-1',
				context: {
					token: '[REDACTED]',
					url: 'https://***@gitlab.com/nao/context.git',
					items: ['[Circular]', '[Circular]'],
				},
			});
		});
	});
});
