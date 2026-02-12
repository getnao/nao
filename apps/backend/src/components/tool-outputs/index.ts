import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type { ReactNode } from 'react';

import { renderToMarkdown } from '../../lib/markdown/render-to-markdown';

export { DisplayChartOutput } from './display-chart';
export { ExecuteSqlOutput } from './execute-sql';
export { GrepOutput } from './grep';
export { ListOutput } from './list';
export { ReadOutput } from './read';
export { SearchOutput } from './search';

/** Renders a tool output component to markdown for the model, falling back to JSON if the result is empty. */
export function renderToModelOutput(node: ReactNode, fallback: unknown): ToolResultOutput {
	const markdown = renderToMarkdown(node);
	return { type: 'text', value: markdown || JSON.stringify(fallback) };
}
