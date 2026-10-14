import { getActiveProjectId } from '@/lib/active-project';

interface McpOAuthMessage {
	type: 'nao-mcp-oauth';
	status: 'connected' | 'error';
	server: string;
	message?: string;
}

export interface McpConnectResult {
	connected: boolean;
	error?: string;
}

const isOAuthMessage = (data: unknown): data is McpOAuthMessage =>
	!!data && typeof data === 'object' && (data as McpOAuthMessage).type === 'nao-mcp-oauth';

/**
 * Opens the per-user MCP OAuth flow in a popup and resolves once the user connected, the flow
 * failed, or the popup was closed. The popup posts a message back to this window on completion.
 */
export function openMcpConnectPopup(server: string): Promise<McpConnectResult> {
	const params = new URLSearchParams({ server, returnTo: window.location.pathname });
	const projectId = getActiveProjectId();
	if (projectId) {
		params.set('projectId', projectId);
	}

	const popup = window.open(`/api/mcp-oauth/connect?${params.toString()}`, 'nao-mcp-oauth', 'width=520,height=720');
	if (!popup) {
		return Promise.resolve({ connected: false, error: 'The browser blocked the connection popup.' });
	}

	return new Promise<McpConnectResult>((resolve) => {
		let settled = false;

		const cleanup = () => {
			window.removeEventListener('message', onMessage);
			window.clearInterval(timer);
		};

		const finish = (result: McpConnectResult) => {
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
			if (event.data.server !== server) {
				return;
			}
			if (event.data.status === 'connected') {
				finish({ connected: true });
			} else {
				finish({ connected: false, error: event.data.message ?? 'Connection failed.' });
			}
		};

		const timer = window.setInterval(() => {
			if (popup.closed) {
				finish({ connected: false });
			}
		}, 500);

		window.addEventListener('message', onMessage);
	});
}
