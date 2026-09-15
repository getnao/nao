import { useLayoutEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_ASPECT_RATIO = 0.75;

/**
 * Renders a dbt Charts SVG in a sandboxed iframe so its embedded tooltip script runs
 * without reaching the app, sized to the SVG's aspect ratio at the container's width.
 */
export function DbtChartsSvg({ svg, className }: { svg: string; className?: string }) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(0);
	const aspectRatio = useMemo(() => svgAspectRatio(svg), [svg]);
	const srcDoc = useMemo(() => buildDocument(svg), [svg]);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const observer = new ResizeObserver((entries) => {
			const nextWidth = entries[0]?.contentRect.width ?? 0;
			setWidth(Math.floor(nextWidth));
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	return (
		<div ref={containerRef} className={className}>
			{width > 0 && (
				<iframe
					title='dbt Charts board'
					sandbox='allow-scripts'
					srcDoc={srcDoc}
					className='block w-full border-0 bg-transparent'
					style={{ height: Math.ceil(width * aspectRatio) }}
					scrolling='no'
				/>
			)}
		</div>
	);
}

function buildDocument(svg: string): string {
	return [
		'<!doctype html><html><head><meta charset="utf-8">',
		'<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block;width:100%;height:auto}</style>',
		'</head><body>',
		svg,
		'</body></html>',
	].join('');
}

function svgAspectRatio(svg: string): number {
	const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
	const width = parseFloat(readAttribute(root, 'width') ?? '');
	const height = parseFloat(readAttribute(root, 'height') ?? '');
	if (width > 0 && height > 0) {
		return height / width;
	}
	const viewBox = readAttribute(root, 'viewBox')
		?.split(/[\s,]+/)
		.map(parseFloat);
	if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
		return viewBox[3] / viewBox[2];
	}
	return DEFAULT_ASPECT_RATIO;
}

function readAttribute(tag: string, name: string): string | undefined {
	return tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1];
}
