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
			.map((n) => renderToMarkdown(n))
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

	const sep = (el.props?.['data-separator'] ?? separator) as string;
	return renderToMarkdown(el.props?.children, sep);
}
