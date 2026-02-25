import { type ReactElement, type ReactNode } from 'react';

import { isRenderable } from './components';

type ElementProps =
	| {
			children?: ReactNode;
			[key: string]: unknown;
	  }
	| undefined;

/**
 * Renders a React node to a markdown string.
 */
export function renderToMarkdown(node: ReactNode, separator = ''): string {
	if (typeof node === 'string') {
		return node;
	}

	if (typeof node === 'number') {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node
			.filter(isRenderable)
			.map((n) => renderToMarkdown(n, separator))
			.join(separator);
	}

	if (node == null || typeof node !== 'object' || !('type' in node)) {
		return '';
	}

	const el = node as ReactElement<ElementProps>;

	if (typeof el.type === 'function') {
		const result = (el.type as (props: ElementProps) => ReactNode)(el.props);
		return renderToMarkdown(result);
	}

	separator = (el.props?.['data-separator'] ?? separator) as string;
	const indent = el.props?.['data-indent'];

	const rendered = renderToMarkdown(el.props?.children, separator);

	if (typeof indent !== 'string' || indent.length === 0 || rendered.length === 0) {
		return rendered;
	}

	return rendered
		.split('\n')
		.map((line) => `${indent}${line}`)
		.join('\n');
}
