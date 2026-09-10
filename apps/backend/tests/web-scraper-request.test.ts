import { describe, expect, it } from 'vitest';

import { resolveHeaders } from '../src/services/web-scraper/request';

describe('web robot request headers', () => {
	it('resolves environment references from project env first', () => {
		const previous = process.env.WEB_ROBOT_TOKEN;
		process.env.WEB_ROBOT_TOKEN = 'process-secret';
		try {
			expect(
				resolveHeaders(
					{
						'x-api-key': { env: 'WEB_ROBOT_TOKEN' },
						accept: 'application/json',
					},
					{ WEB_ROBOT_TOKEN: 'project-secret' },
				),
			).toEqual({ 'x-api-key': 'project-secret', accept: 'application/json' });
		} finally {
			if (previous === undefined) {
				delete process.env.WEB_ROBOT_TOKEN;
			} else {
				process.env.WEB_ROBOT_TOKEN = previous;
			}
		}
	});

	it('rejects literal sensitive headers at execution time too', () => {
		expect(() => resolveHeaders({ authorization: 'Bearer secret' }, {})).toThrow('environment variable');
	});

	it('fails when a referenced environment variable is missing', () => {
		expect(() => resolveHeaders({ 'x-api-key': { env: 'MISSING_WEB_ROBOT_TOKEN' } }, {})).toThrow(
			"missing environment variable 'MISSING_WEB_ROBOT_TOKEN'",
		);
	});
});
