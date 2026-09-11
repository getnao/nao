import assert from 'node:assert/strict';
import test from 'node:test';

import { pollRead } from './bootstrap.mjs';

test('pollRead retries bounded reads until ready', async () => {
	let attempts = 0;
	const result = await pollRead(
		'test resource',
		100,
		async () => {
			attempts += 1;
			return attempts === 2 ? 'ready' : null;
		},
		1,
	);

	assert.equal(result, 'ready');
	assert.equal(attempts, 2);
});

test('pollRead reports the last read error at its deadline', async () => {
	await assert.rejects(
		pollRead(
			'test resource',
			10,
			async () => {
				throw new Error('not ready');
			},
			1,
		),
		/test resource did not become ready within 0.01 seconds\. Last error: not ready/,
	);
});
