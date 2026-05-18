import { useEffect } from 'react';

export const NAO_MCP_APP_EMBED_SIZE_MSG = 'nao-embed-size' as const;

export const NAO_MCP_EMBED_MEASURE_ATTR = 'data-nao-mcp-embed-measure';

export function useMcpAppEmbedHeightReporting(): void {
	useEffect(() => {
		if (typeof window === 'undefined' || window.parent === window) {
			return;
		}

		let raf = 0;
		const report = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const height = readEmbedMeasureHeight();
				window.parent.postMessage({ type: NAO_MCP_APP_EMBED_SIZE_MSG, height }, '*');
			});
		};

		const ro = new ResizeObserver(report);
		const measured = document.querySelector(`[${NAO_MCP_EMBED_MEASURE_ATTR}]`);
		if (measured) {
			ro.observe(measured);
		} else {
			ro.observe(document.documentElement);
			ro.observe(document.body);
		}

		report();
		window.addEventListener('load', report);

		const delayedShort = window.setTimeout(report, 80);
		const delayedChart = window.setTimeout(report, 240);

		return () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(delayedShort);
			window.clearTimeout(delayedChart);
			ro.disconnect();
			window.removeEventListener('load', report);
		};
	}, []);
}

function readEmbedMeasureHeight(): number {
	const measured = document.querySelector(`[${NAO_MCP_EMBED_MEASURE_ATTR}]`);
	if (measured) {
		const el = measured as HTMLElement;
		return Math.ceil(Math.max(el.scrollHeight, el.offsetHeight, el.getBoundingClientRect().height, 1) + 6);
	}
	return Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) + 6);
}
