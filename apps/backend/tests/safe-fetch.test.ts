import { describe, expect, it } from 'vitest';

import { isPrivateHostname } from '../src/utils/safe-fetch';

describe('isPrivateHostname', () => {
	it.each([
		'127.0.0.1',
		'10.1.2.3',
		'[::1]',
		'[::]',
		'[::ffff:127.0.0.1]',
		'[::ffff:7f00:1]',
		'[::ffff:a9fe:a9fe]',
		'[0:0:0:0:0:ffff:7f00:1]',
		'[::7f00:1]',
		'[64:ff9b::7f00:1]',
		'[fc00::1]',
		'[fe80::1]',
		'[ff02::1]',
		'localhost',
		'metadata.internal',
	])('rejects %s', (host) => {
		expect(isPrivateHostname(host)).toBe(true);
	});

	it.each(['8.8.8.8', '[2606:4700::1111]', '[::ffff:808:808]', '[64:ff9b::808:808]', 'example.com'])(
		'allows %s',
		(host) => {
			expect(isPrivateHostname(host)).toBe(false);
		},
	);

	it('rejects hostnames the URL parser normalizes to hex IPv4-mapped form', () => {
		const { hostname } = new URL('http://[::ffff:127.0.0.1]/');
		expect(isPrivateHostname(hostname)).toBe(true);
	});
});
