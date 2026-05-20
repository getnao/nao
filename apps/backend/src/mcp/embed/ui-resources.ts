import { createHash } from 'node:crypto';

import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { env } from '../../env';
import { mcpAppsScriptUrl } from './mcp-apps-bundle';

export const STORY_APP_URI = 'ui://nao/app/story.html';
export const CHART_APP_URI = 'ui://nao/app/chart.html';

export function registerNaoMcpApps(server: McpServer): void {
	registerAppResource(
		server,
		'Nao Story App',
		STORY_APP_URI,
		{ title: 'Nao Story App', _meta: { ui: buildListingUiMeta() } },
		async () => ({
			contents: [
				{
					uri: STORY_APP_URI,
					mimeType: RESOURCE_MIME_TYPE,
					text: buildAppShellHtml('Nao Story'),
					_meta: { ui: buildContentUiMeta(server) },
				},
			],
		}),
	);

	registerAppResource(
		server,
		'Nao Chart App',
		CHART_APP_URI,
		{ title: 'Nao Chart App', _meta: { ui: buildListingUiMeta() } },
		async () => ({
			contents: [
				{
					uri: CHART_APP_URI,
					mimeType: RESOURCE_MIME_TYPE,
					text: buildAppShellHtml('Nao Chart'),
					_meta: { ui: buildContentUiMeta(server) },
				},
			],
		}),
	);
}

export function uiToolMeta(resourceUri: string): Record<string, unknown> {
	return {
		ui: { resourceUri },
	};
}

function buildListingUiMeta(): Record<string, unknown> {
	const naoOrigin = new URL(env.BETTER_AUTH_URL).origin;
	return {
		csp: buildCsp(naoOrigin),
		permissions: { clipboardWrite: {} },
	};
}

function buildContentUiMeta(server: McpServer): Record<string, unknown> {
	const naoOrigin = new URL(env.BETTER_AUTH_URL).origin;
	const meta: Record<string, unknown> = {
		csp: buildCsp(naoOrigin),
		permissions: { clipboardWrite: {} },
	};
	const domain = resolveSandboxDomain(server, naoOrigin);
	if (domain) {
		meta.domain = domain;
	}
	return meta;
}

function buildCsp(origin: string) {
	return {
		connectDomains: [origin],
		frameDomains: [origin],
		resourceDomains: [origin],
	};
}

function resolveSandboxDomain(server: McpServer, naoOrigin: string): string | null {
	const clientName = readClientName(server);
	if (!clientName) {
		return null;
	}
	if (clientName.includes('claude')) {
		return computeClaudeSandboxDomain(`${naoOrigin}/mcp`);
	}
	if (clientName.includes('chatgpt') || clientName.includes('openai')) {
		return naoOrigin;
	}
	return null;
}

function readClientName(server: McpServer): string | null {
	try {
		const info = server.server.getClientVersion();
		return info?.name ? info.name.toLowerCase() : null;
	} catch {
		return null;
	}
}

function computeClaudeSandboxDomain(mcpServerUrl: string): string {
	const hash = createHash('sha256').update(mcpServerUrl).digest('hex').slice(0, 32);
	return `${hash}.claudemcpcontent.com`;
}

function buildAppShellHtml(documentTitle: string): string {
	const mcpAppsUrl = mcpAppsScriptUrl(env.BETTER_AUTH_URL);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtmlText(documentTitle)}</title>
<style>
html,body{margin:0;padding:0;background:transparent;color-scheme:light}
body{display:flex;flex-direction:column;font:14px/1.4 system-ui,sans-serif}
body.is-loading{min-height:160px}
#nao-status{padding:10px 14px;color:#666;font-size:13px;text-align:center}
#nao-status.error{color:#b00020;background:rgba(176,0,32,.06);border-radius:6px;margin:8px}
#nao-status[hidden]{display:none}
#nao-frame{display:block;width:100%;height:640px;border:0;background:transparent}
#nao-frame[hidden]{display:none}
</style>
</head>
<body>
<div id="nao-status" role="status">Starting…</div>
<iframe id="nao-frame" hidden allow="clipboard-write *; downloads *"></iframe>
<script src="${escapeHtmlAttr(mcpAppsUrl)}" onerror="try{console.warn('[nao-mcp-app] mcp-apps.js failed to load from ${escapeHtmlAttr(mcpAppsUrl)}')}catch(e){}"></script>
<script>
(function () {
	var statusEl = document.getElementById('nao-status');
	var frame = document.getElementById('nao-frame');
	var body = document.body;
	body.classList.add('is-loading');
	var embedResizeListener = null;
	var embedLoadWatchTimer = null;
	var lastBlobUrl = null;
	var pendingBlobFallbackTimer = null;
	var pendingBlobFallbackHtml = null;
	var sawEmbedResizeFromCurrentNavigation = false;
	var currentEmbedFallbackHtml = null;
	var currentEmbedUrlForLink = null;

	function clearEmbedLoadWatch() {
		if (embedLoadWatchTimer) {
			clearTimeout(embedLoadWatchTimer);
			embedLoadWatchTimer = null;
		}
	}

	function clearPendingBlobFallback() {
		if (pendingBlobFallbackTimer) {
			clearTimeout(pendingBlobFallbackTimer);
			pendingBlobFallbackTimer = null;
		}
		pendingBlobFallbackHtml = null;
	}

	function detachEmbedResizeListener() {
		if (embedResizeListener) {
			window.removeEventListener('message', embedResizeListener);
			embedResizeListener = null;
		}
	}

	function attachEmbedResizeListener() {
		detachEmbedResizeListener();
		embedResizeListener = function (event) {
			if (event.source !== frame.contentWindow) return;
			if (!event.data || event.data.type !== 'nao-embed-size') return;
			sawEmbedResizeFromCurrentNavigation = true;
			clearPendingBlobFallback();
			clearEmbedLoadWatch();
			hideStatus();
			var h = event.data.height;
			if (typeof h !== 'number' || !isFinite(h) || h < 40 || h > 8000) return;
			// Extra slack beyond ceil(h): subpixel layout, iframe chrome, and host rounding
			// otherwise the iframe is a few px short and the inner document shows a tiny scroll.
			var next = Math.min(Math.ceil(h) + 32, 8000);
			var floorPx = 320;
			frame.style.height = Math.max(next, floorPx) + 'px';
		};
		window.addEventListener('message', embedResizeListener);
	}

	function setStatus(text, isError) {
		statusEl.textContent = text;
		statusEl.className = isError ? 'error' : '';
		statusEl.hidden = false;
		try { console.log('[nao-mcp-app]', isError ? 'ERROR' : 'INFO', text); } catch (e) {}
	}
	function hideStatus() { statusEl.hidden = true; statusEl.textContent = ''; }

	function setSrc(url, options) {
		options = options || {};
		if (!url || frame.src === url) return;
		detachEmbedResizeListener();
		clearPendingBlobFallback();
		clearEmbedLoadWatch();
		var prevBlob = lastBlobUrl;
		lastBlobUrl = null;
		sawEmbedResizeFromCurrentNavigation = false;
		var fallbackHtml = options.fallbackBlobHtml;
		currentEmbedFallbackHtml =
			typeof fallbackHtml === 'string' && fallbackHtml.length > 0 ? fallbackHtml : null;
		currentEmbedUrlForLink = url.indexOf('blob:') !== 0 && /^https?:\\/\\//.test(url) ? url : null;
		setStatus(url.indexOf('blob:') === 0 ? 'Loading preview…' : 'Loading chart…');
		attachEmbedResizeListener();
		var useBlobFallback = currentEmbedFallbackHtml && url.indexOf('blob:') !== 0 && /^https?:\\/\\//.test(url);
		if (useBlobFallback) {
			pendingBlobFallbackHtml = currentEmbedFallbackHtml;
			pendingBlobFallbackTimer = setTimeout(function () {
				if (sawEmbedResizeFromCurrentNavigation || !pendingBlobFallbackHtml) return;
				var html = pendingBlobFallbackHtml;
				clearPendingBlobFallback();
				setBlobHtml(html);
			}, 1600);
		}
		if (currentEmbedUrlForLink) {
			embedLoadWatchTimer = setTimeout(function () {
				embedLoadWatchTimer = null;
				if (sawEmbedResizeFromCurrentNavigation) return;
				if (currentEmbedFallbackHtml) {
					setBlobHtml(currentEmbedFallbackHtml);
					return;
				}
				setStatus(
					'Embed did not load (iframe blocked or BETTER_AUTH_URL mismatch). Open the link from the tool reply.',
					true,
				);
			}, 4000);
		}
		frame.addEventListener('load', function () {
			body.classList.remove('is-loading');
			if (!sawEmbedResizeFromCurrentNavigation) {
				hideStatus();
			}
			if (prevBlob && prevBlob !== url) {
				try {
					URL.revokeObjectURL(prevBlob);
				} catch (e) {}
			}
		}, { once: true });
		frame.src = url;
		if (url.indexOf('blob:') === 0) {
			lastBlobUrl = url;
		}
		frame.hidden = false;
	}

	function setBlobHtml(html) {
		if (!html) return;
		var u;
		try {
			u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
		} catch (err) {
			setStatus('Chart preview could not be loaded.', true);
			return;
		}
		setSrc(u);
	}

	function parseJsonText(text) {
		try {
			return JSON.parse(text);
		} catch (e) {
			return null;
		}
	}

	function normalizeToolPayload(raw) {
		if (raw == null) return null;
		var p = raw;
		if (typeof p === 'string') {
			p = parseJsonText(p);
			if (!p) return null;
		}
		if (typeof p !== 'object' || Array.isArray(p)) return null;
		var sc = p.structuredContent;
		if (sc && typeof sc === 'object' && !Array.isArray(sc)) {
			p = sc;
		}
		var embedUrl =
			typeof p.embedUrl === 'string' ? p.embedUrl : typeof p.embed_url === 'string' ? p.embed_url : '';
		var chartBlob = typeof p.sandboxChartHtml === 'string' ? p.sandboxChartHtml : '';
		var storyBlob = typeof p.sandboxStoryHtml === 'string' ? p.sandboxStoryHtml : '';
		var sandboxBlob = chartBlob || storyBlob;
		if (!embedUrl && !sandboxBlob) return null;
		return { embedUrl: embedUrl, sandboxChartHtml: sandboxBlob };
	}

	function payloadFromContentBlocks(content) {
		if (!Array.isArray(content)) return null;
		for (var i = 0; i < content.length; i++) {
			var block = content[i];
			if (block && block.type === 'text' && typeof block.text === 'string') {
				var parsed = parseJsonText(block.text);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					return normalizeToolPayload(parsed);
				}
			}
		}
		return null;
	}

	function mergeAppFields(primary, secondary) {
		if (!primary && !secondary) return null;
		if (!primary) return secondary;
		if (!secondary) return primary;
		var sandboxBlob =
			primary.sandboxChartHtml ||
			secondary.sandboxChartHtml ||
			primary.sandboxStoryHtml ||
			secondary.sandboxStoryHtml;
		return {
			embedUrl: primary.embedUrl || secondary.embedUrl,
			sandboxChartHtml: sandboxBlob,
		};
	}

	function resolveToolPayload(raw) {
		var fromContent = null;
		var envelope = null;
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			if (Array.isArray(raw.content)) {
				fromContent = payloadFromContentBlocks(raw.content);
			}
			envelope = normalizeToolPayload(raw);
			if (raw.structuredContent) {
				envelope = mergeAppFields(envelope, normalizeToolPayload(raw.structuredContent));
			}
			if (raw.result != null) {
				envelope = mergeAppFields(envelope, resolveToolPayload(raw.result));
			}
			if (raw.params != null) {
				envelope = mergeAppFields(envelope, resolveToolPayload(raw.params));
			}
			if (raw.data != null) {
				envelope = mergeAppFields(envelope, resolveToolPayload(raw.data));
			}
		} else if (typeof raw === 'string') {
			envelope = normalizeToolPayload(raw);
		}
		return mergeAppFields(envelope, fromContent);
	}

	var hasRenderedPreview = false;

	function applyToolPayload(raw) {
		var p = resolveToolPayload(raw);
		if (!p) return false;
		var chartBlob = p.sandboxChartHtml;
		var embedUrl = p.embedUrl;
		var sandboxFallback = chartBlob;
		if (embedUrl.length > 0) {
			setSrc(embedUrl, sandboxFallback.length > 0 ? { fallbackBlobHtml: sandboxFallback } : {});
			hasRenderedPreview = true;
			return true;
		}
		if (chartBlob.length > 0) {
			setBlobHtml(chartBlob);
			hasRenderedPreview = true;
			return true;
		}
		return false;
	}

	function ingestToolResult(raw) {
		return applyToolPayload(raw);
	}

	var mcpApp = null;
	var hostHandshakeDone = false;

	function markHostReady() {
		if (hostHandshakeDone) return;
		hostHandshakeDone = true;
		if (!hasRenderedPreview) {
			setStatus('Waiting for chart…');
		}
		try {
			console.log('[nao-mcp-app] host handshake ready');
		} catch (e) {}
	}

	function handleHostToolResult(params) {
		if (ingestToolResult(params)) {
			hideStatus();
		}
	}

	function wireHostToolBridge() {
		window.addEventListener(
			'message',
			function (event) {
				var msg = event.data;
				if (!msg || typeof msg !== 'object') return;
				if (msg.jsonrpc === '2.0' && typeof msg.method === 'string') {
					if (msg.method === 'ui/notifications/tool-result') {
						handleHostToolResult(msg.params);
					} else if (msg.method === 'ui/notifications/tool-cancelled') {
						setStatus('Tool execution cancelled.', true);
					}
					return;
				}
				if (msg.type === 'tool-result' || msg.type === 'toolResult') {
					handleHostToolResult(msg.payload || msg.data || msg);
				}
			},
			{ passive: true },
		);
	}

	function runManualHostHandshake() {
		if (hostHandshakeDone) return;
		var initId = 1;
		var finished = false;
		function finish() {
			if (finished) return;
			finished = true;
			window.removeEventListener('message', onInitReply);
			try {
				window.parent.postMessage(
					{ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} },
					'*',
				);
			} catch (e) {}
			markHostReady();
		}
		function onInitReply(event) {
			var msg = event.data;
			if (!msg || msg.jsonrpc !== '2.0') return;
			if (msg.id === initId && msg.result) finish();
		}
		window.addEventListener('message', onInitReply);
		setTimeout(finish, 5000);
		try {
			window.parent.postMessage(
				{
					jsonrpc: '2.0',
					id: initId,
					method: 'ui/initialize',
					params: {
						protocolVersion: '2026-01-26',
						appInfo: { name: 'nao-mcp-app', version: '0.1.0' },
						appCapabilities: { availableDisplayModes: ['inline'] },
					},
				},
				'*',
			);
		} catch (e) {
			finish();
		}
	}

	function connectToHost() {
		setStatus('Connecting…');
		if (typeof globalThis.App === 'function' && typeof globalThis.PostMessageTransport === 'function') {
			mcpApp = new globalThis.App({ name: 'nao-mcp-app', version: '0.1.0' }, { autoResize: false });
			mcpApp.addEventListener('toolresult', handleHostToolResult);
			mcpApp.ontoolcancelled = function () {
				setStatus('Tool execution cancelled.', true);
			};
			mcpApp
				.connect(new globalThis.PostMessageTransport(window.parent, window.parent))
				.then(function () {
					markHostReady();
				})
				.catch(function (err) {
					try {
						console.warn('[nao-mcp-app] App.connect failed; manual handshake', err);
					} catch (e2) {}
					runManualHostHandshake();
				});
			return;
		}
		try {
			console.warn('[nao-mcp-app] mcp-apps.js missing — manual ui/initialize handshake');
		} catch (e3) {}
		runManualHostHandshake();
	}

	wireHostToolBridge();
	connectToHost();

	var openLinkViaHost = function (url) {
		if (mcpApp && typeof mcpApp.openLink === 'function') {
			mcpApp.openLink({ url: url }).catch(function (err) {
				setStatus('Could not open link: ' + (err && err.message || err), true);
			});
			return;
		}
		try {
			window.open(url, '_blank', 'noopener,noreferrer');
		} catch (e) {}
	};

	window.addEventListener('message', function (event) {
		var msg = event.data;
		if (!msg || typeof msg !== 'object') return;
		if (msg.type === 'nao-open-link' && typeof msg.url === 'string') {
			openLinkViaHost(msg.url);
		}
	});
})();
</script>
</body>
</html>`;
}

function escapeHtmlText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value: string): string {
	return escapeHtmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
