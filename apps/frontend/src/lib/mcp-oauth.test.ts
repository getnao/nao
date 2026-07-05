// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openMcpConnectPopup } from './mcp-oauth';

describe('openMcpConnectPopup', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('ignores OAuth messages that do not come from the opened popup', async () => {
		const popup = { closed: false } as Window;
		const otherWindow = { closed: false } as Window;
		vi.spyOn(window, 'open').mockReturnValue(popup);

		const result = openMcpConnectPopup('metabase');
		window.dispatchEvent(
			new MessageEvent('message', {
				origin: window.location.origin,
				source: otherWindow,
				data: { type: 'nao-mcp-oauth', status: 'connected', server: 'metabase' },
			}),
		);

		await expect(Promise.race([result.then(() => 'resolved'), Promise.resolve('pending')])).resolves.toBe(
			'pending',
		);

		window.dispatchEvent(
			new MessageEvent('message', {
				origin: window.location.origin,
				source: popup,
				data: { type: 'nao-mcp-oauth', status: 'connected', server: 'metabase' },
			}),
		);

		await expect(result).resolves.toBe(true);
	});
});
