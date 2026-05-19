import type { QueryDataMap } from '../../utils/story-download';
import { generateStoryHtml } from '../../utils/story-html';
import { resolveStoryQueryDataForSandbox } from '../../utils/story-query-data';
import { storyEmbedUrls } from '../urls';
import { MAX_SANDBOX_HTML_CHARS } from './embed-payload';
import { SANDBOX_EMBED_ROOT_STYLES, SANDBOX_ICON_DOWNLOAD, SANDBOX_ICON_EXTERNAL_LINK } from './header';

type StorySandboxHeaderConfig = {
	kind: 'story';
	title: string;
	openUrl: string;
	pdfUrl: string;
	htmlUrl: string;
};

type ChartSandboxHeaderConfig = {
	kind: 'chart';
	title: string;
	naoChatUrl: string | null;
};

export async function buildStorySandboxHtml(params: {
	title: string;
	code: string;
	openInNaoUrl: string;
	storyId: string;
	projectId: string;
	chatId?: string | null;
}): Promise<string | null> {
	const queryData = await resolveStoryQueryDataForSandbox(params.code, {
		storyId: params.storyId,
		chatId: params.chatId,
		projectId: params.projectId,
	});
	const inner = wrapStoryBodyForMcpHeightMeasure(
		generateStoryHtml({ title: params.title, code: params.code }, (queryData as QueryDataMap | null) ?? null),
	);
	const withEmbedStyle = injectMcpEmbedRootStyles(inner);

	const { pdfUrl, htmlUrl } = storyEmbedUrls(params.storyId, params.projectId);
	const footerScript = buildSandboxEmbedFooterScript({
		kind: 'story',
		title: params.title,
		openUrl: params.openInNaoUrl,
		pdfUrl,
		htmlUrl,
	});

	return finalizeSandboxHtml(withEmbedStyle, footerScript);
}

export function buildChartSandboxHtml(params: {
	title: string;
	chartBlock: string;
	queryId: string;
	columns: string[];
	data: Record<string, unknown>[];
	naoChatUrl: string | null;
}): string | null {
	const code = `# ${params.title}\n\n${params.chartBlock}`;
	const queryData: QueryDataMap = {
		[params.queryId]: { columns: params.columns, data: params.data },
	};
	const inner = wrapStoryBodyForMcpHeightMeasure(generateStoryHtml({ title: params.title, code }, queryData));
	const withEmbedStyle = injectMcpEmbedRootStyles(inner);

	const footerScript = buildSandboxEmbedFooterScript({
		kind: 'chart',
		title: params.title,
		naoChatUrl: params.naoChatUrl,
	});

	return finalizeSandboxHtml(withEmbedStyle, footerScript);
}

function buildSandboxEmbedFooterScript(config: StorySandboxHeaderConfig | ChartSandboxHeaderConfig): string {
	const titleJs = escapeJsStringLiteral(config.title);
	const headerActionsJs =
		config.kind === 'story' ? buildStoryHeaderActionsJs(config) : buildChartHeaderActionsJs(config);

	return `
<script>
(function () {
	var headerTitle = ${titleJs};
	${headerActionsJs}
	function postOpenLink(url) {
		if (typeof parent !== 'undefined' && parent !== window) {
			parent.postMessage({ type: 'nao-open-link', url: url }, '*');
		}
	}
	function measureHeight() {
		var m = document.getElementById('nao-mcp-story-measure');
		if (m) {
			return Math.ceil(Math.max(80, m.scrollHeight, m.offsetHeight, m.getBoundingClientRect().height) + 6);
		}
		var e = document.documentElement;
		var b = document.body;
		return Math.ceil(Math.max(80, e.scrollHeight, b.scrollHeight) + 6);
	}
	function reportSize() {
		var h = measureHeight();
		if (typeof parent !== 'undefined' && parent !== window) {
			parent.postMessage({ type: 'nao-embed-size', height: Math.min(Math.max(h, 80), 8000) }, '*');
		}
	}
	function scheduleReports() {
		reportSize();
		requestAnimationFrame(function () {
			reportSize();
			requestAnimationFrame(reportSize);
		});
		[50, 150, 400, 900, 2000, 3500].forEach(function (ms) {
			setTimeout(reportSize, ms);
		});
	}
	function buildHeaderChrome() {
		var header = document.createElement('header');
		header.setAttribute('data-nao-mcp-app-header', '1');
		header.setAttribute('data-nao-mcp-story-chrome', '1');
		var h1 = document.createElement('h1');
		h1.textContent = headerTitle;
		var actions = document.createElement('div');
		actions.className = 'nao-mcp-header-actions';
		buildHeaderActions(actions);
		header.appendChild(h1);
		header.appendChild(actions);
		return header;
	}
	var chrome = buildHeaderChrome();
	var mRoot = document.getElementById('nao-mcp-story-measure');
	if (mRoot && mRoot.firstChild) {
		mRoot.insertBefore(chrome, mRoot.firstChild);
	} else if (mRoot) {
		mRoot.appendChild(chrome);
	} else {
		document.body.insertBefore(chrome, document.body.firstChild);
	}
	window.addEventListener('load', scheduleReports);
	window.addEventListener('resize', reportSize);
	if (typeof ResizeObserver !== 'undefined') {
		try {
			var mEl = document.getElementById('nao-mcp-story-measure');
			var ro = new ResizeObserver(reportSize);
			if (mEl) {
				ro.observe(mEl);
			} else {
				ro.observe(document.documentElement);
				ro.observe(document.body);
			}
		} catch (err) {}
	}
	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(reportSize).catch(function () {});
	}
	reportSize();
})();
</script>
`;
}

function buildStoryHeaderActionsJs(config: StorySandboxHeaderConfig): string {
	const openUrl = escapeJsStringLiteral(config.openUrl);
	const pdfUrl = escapeJsStringLiteral(config.pdfUrl);
	const htmlUrl = escapeJsStringLiteral(config.htmlUrl);
	const downloadBtnHtml = escapeJsStringLiteral(
		`${SANDBOX_ICON_DOWNLOAD}<span class="nao-mcp-btn-text">Download</span>`,
	);
	const openBtnHtml = escapeJsStringLiteral(
		`${SANDBOX_ICON_EXTERNAL_LINK}<span class="nao-mcp-btn-text">Open in nao</span>`,
	);

	return `
	function buildHeaderActions(actions) {
		var openUrl = ${openUrl};
		var pdfUrl = ${pdfUrl};
		var htmlUrl = ${htmlUrl};
		var dlWrap = document.createElement('div');
		dlWrap.className = 'nao-mcp-dl-wrap';
		var dlBtn = document.createElement('button');
		dlBtn.type = 'button';
		dlBtn.className = 'nao-mcp-btn';
		dlBtn.innerHTML = ${downloadBtnHtml};
		dlBtn.setAttribute('aria-haspopup', 'true');
		var menu = document.createElement('div');
		menu.setAttribute('role', 'menu');
		menu.className = 'nao-mcp-menu';
		function addItem(label, url) {
			var mi = document.createElement('button');
			mi.type = 'button';
			mi.setAttribute('role', 'menuitem');
			mi.className = 'nao-mcp-menuitem';
			mi.textContent = label;
			mi.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				menu.style.display = 'none';
				postOpenLink(url);
			});
			menu.appendChild(mi);
		}
		addItem('PDF', pdfUrl);
		addItem('HTML', htmlUrl);
		dlBtn.addEventListener('click', function (e) {
			e.preventDefault();
			e.stopPropagation();
			menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
		});
		document.addEventListener('click', function (ev) {
			if (!dlWrap.contains(ev.target)) {
				menu.style.display = 'none';
			}
		});
		dlWrap.appendChild(dlBtn);
		dlWrap.appendChild(menu);
		var openBtn = document.createElement('button');
		openBtn.type = 'button';
		openBtn.className = 'nao-mcp-btn';
		openBtn.setAttribute('title', 'Open in nao');
		openBtn.innerHTML = ${openBtnHtml};
		openBtn.addEventListener('click', function (e) {
			e.preventDefault();
			postOpenLink(openUrl);
		});
		actions.appendChild(dlWrap);
		actions.appendChild(openBtn);
	}`;
}

function buildChartHeaderActionsJs(config: ChartSandboxHeaderConfig): string {
	const naoChatUrlJs = config.naoChatUrl ? escapeJsStringLiteral(config.naoChatUrl) : 'null';
	const openBtnHtml = escapeJsStringLiteral(
		`${SANDBOX_ICON_EXTERNAL_LINK}<span class="nao-mcp-btn-text">Open in nao</span>`,
	);

	return `
	function buildHeaderActions(actions) {
		var naoChatUrl = ${naoChatUrlJs};
		if (!naoChatUrl) return;
		var openBtn = document.createElement('button');
		openBtn.type = 'button';
		openBtn.className = 'nao-mcp-btn';
		openBtn.setAttribute('title', 'Open in nao');
		openBtn.innerHTML = ${openBtnHtml};
		openBtn.addEventListener('click', function (e) {
			e.preventDefault();
			postOpenLink(naoChatUrl);
		});
		actions.appendChild(openBtn);
	}`;
}

function finalizeSandboxHtml(html: string, footerScript: string): string | null {
	const doc = html.replace(/<\/body>\s*<\/html>\s*$/i, `${footerScript}</body></html>`);
	if (doc.length > MAX_SANDBOX_HTML_CHARS) {
		return null;
	}
	return doc;
}

function injectMcpEmbedRootStyles(html: string): string {
	return html.includes('</title>')
		? html.replace(/<\/title>/i, `</title>${SANDBOX_EMBED_ROOT_STYLES}`)
		: html.replace(/<head[^>]*>/i, (m) => `${m}${SANDBOX_EMBED_ROOT_STYLES}`);
}

function wrapStoryBodyForMcpHeightMeasure(html: string): string {
	const withOpen = html.replace(/<body(\s[^>]*)?>/i, '<body$1><div id="nao-mcp-story-measure">');
	return withOpen.replace(/<\/body>/i, '</div></body>');
}

function escapeJsStringLiteral(value: string): string {
	return JSON.stringify(value);
}
