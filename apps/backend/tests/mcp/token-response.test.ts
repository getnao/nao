import { describe, expect, it } from 'vitest';

import { omitRedundantTokenExpiry } from '../../src/mcp/token-response';

describe('omitRedundantTokenExpiry', () => {
	it('removes a numeric expires_at extension when expires_in is present', () => {
		const response = {
			access_token: 'access-token',
			expires_at: 1_794_582_264,
			expires_in: 86_400,
			token_type: 'Bearer',
		};
		expect(omitRedundantTokenExpiry(response)).toEqual({
			access_token: 'access-token',
			expires_in: 86_400,
			token_type: 'Bearer',
		});
	});

	it.each([
		[
			'expires_at is not numeric',
			{ access_token: 'access-token', expires_at: '2026-11-13T15:04:24Z', expires_in: 86_400 },
		],
		['expires_in is missing', { access_token: 'access-token', expires_at: 1_794_582_264 }],
		['expires_in is not numeric', { access_token: 'access-token', expires_at: 1_794_582_264, expires_in: '86400' }],
		['access_token is missing', { expires_at: 1_794_582_264, expires_in: 86_400 }],
	] as const)('keeps the response when %s', (_reason, response) => {
		expect(omitRedundantTokenExpiry(response)).toBe(response);
	});
});
