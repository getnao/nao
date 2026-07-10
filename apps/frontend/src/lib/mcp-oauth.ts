import { getActiveProjectId } from '@/lib/active-project';

interface McpOAuthMessage {
	type: 'nao-mcp-oauth';
	status: 'connected' | 'error';
	server: string;
}

const isOAuthMessage = (data: unknown): data is McpOAuthMessage =>
	!!data && typeof data === 'object' && (data as McpOAuthMessage).type === 'nao-mcp-oauth';

/**
 * Opens the per-user MCP OAuth flow in a popup and resolves to whether the user connected.
 * The popup posts a message back to this window on completion, then closes itself.
 */
export function openMcpConnectPopup(server: string): Promise<boolean> {
	const params = new URLSearchParams({ server, returnTo: window.location.pathname });
	const projectId = getActiveProjectId();
	if (projectId) {
		params.set('projectId', projectId);
	}

	const popup = window.open(`/api/mcp-oauth/connect?${params.toString()}`, 'nao-mcp-oauth', 'width=520,height=720');
	if (!popup) {
		return Promise.resolve(false);
	}

	return new Promise<boolean>((resolve) => {
		let settled = false;

		const cleanup = () => {
			window.removeEventListener('message', onMessage);
			window.clearInterval(timer);
		};

		const finish = (result: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(result);
		};

		const onMessage = (event: MessageEvent) => {
			if (event.source !== popup || event.origin !== window.location.origin || !isOAuthMessage(event.data)) {
				return;
			}
			if (event.data.server === server) {
				finish(event.data.status === 'connected');
			}
		};

		const timer = window.setInterval(() => {
			if (popup.closed) {
				finish(false);
			}
		}, 500);

		window.addEventListener('message', onMessage);
	});
}
