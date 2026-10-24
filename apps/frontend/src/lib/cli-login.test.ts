import { describe, expect, it } from 'vitest';

import { buildCallbackUrl, getLoginClientCopy, parseCallbackPort, parseLoginClient } from './cli-login';

describe('parseLoginClient', () => {
	it('recognises the desktop app', () => {
		expect(parseLoginClient('desktop')).toBe('desktop');
	});

	it('defaults to the CLI for anything else', () => {
		expect(parseLoginClient(undefined)).toBe('cli');
		expect(parseLoginClient('cli')).toBe('cli');
		expect(parseLoginClient('mobile')).toBe('cli');
	});
});

describe('getLoginClientCopy', () => {
	it('keeps the CLI wording by default', () => {
		expect(getLoginClientCopy('cli').title).toBe('Authorize nao CLI');
		expect(getLoginClientCopy('cli').authorizedMessage).toContain('return to your terminal');
	});

	it('uses desktop wording for the desktop app', () => {
		expect(getLoginClientCopy('desktop').title).toBe('Authorize nao desktop app');
		expect(getLoginClientCopy('desktop').authorizedMessage).toContain('return to the app');
	});
});

describe('parseCallbackPort', () => {
	it('accepts valid TCP ports', () => {
		expect(parseCallbackPort('8765')).toBe(8765);
		expect(parseCallbackPort('65535')).toBe(65535);
	});

	it('rejects missing, malformed and out-of-range ports', () => {
		expect(parseCallbackPort(undefined)).toBeNull();
		expect(parseCallbackPort('0')).toBeNull();
		expect(parseCallbackPort('65536')).toBeNull();
		expect(parseCallbackPort('80; evil')).toBeNull();
	});
});

describe('buildCallbackUrl', () => {
	it('always targets the loopback address', () => {
		expect(buildCallbackUrl(8765, { code: 'a b', state: 's' })).toBe(
			'http://127.0.0.1:8765/callback?code=a+b&state=s',
		);
	});
});
