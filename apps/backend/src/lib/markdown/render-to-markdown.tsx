import type { ReactElement, ReactNode } from 'react';

export function renderToMarkdown(node: ReactNode): string {
	if (node == null || typeof node === 'boolean') {
		return '';
	}
	if (typeof node === 'string') {
		return node;
	}
	if (typeof node === 'number') {
		return String(node);
	}
	if (Array.isArray(node)) {
		return node.map(renderToMarkdown).join('');
	}

	const el = node as ReactElement<Record<string, unknown>>;

	if (typeof el.type === 'function') {
		const result = (el.type as (props: Record<string, unknown>) => ReactNode)(el.props);
		return renderToMarkdown(result);
	}

	if (typeof el.type === 'symbol') {
		return renderToMarkdown(el.props.children as ReactNode);
	}

	return renderToMarkdown(el.props?.children as ReactNode);
}

function childrenToString(children: ReactNode): string {
	return renderToMarkdown(children);
}

export function Title({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
	const prefix = '#'.repeat(level);
	return <>{`${prefix} ${childrenToString(children)}\n\n`}</>;
}

export function P({ children }: { children: ReactNode }) {
	return <>{`${childrenToString(children)}\n\n`}</>;
}

export function Bold({ children }: { children: ReactNode }) {
	return <>{`**${childrenToString(children)}**`}</>;
}

export function Italic({ children }: { children: ReactNode }) {
	return <>{`*${childrenToString(children)}*`}</>;
}

export function Code({ children }: { children: ReactNode }) {
	return <>{`\`${childrenToString(children)}\``}</>;
}

export function CodeBlock({ children, language }: { children: ReactNode; language?: string }) {
	const lang = language ?? '';
	return <>{`\`\`\`${lang}\n${childrenToString(children)}\n\`\`\`\n\n`}</>;
}

export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
	const items = Array.isArray(children) ? children : [children];
	const rendered = items
		.map((child, i) => {
			const text = renderToMarkdown(child);
			if (text.startsWith('- ') || /^\d+\.\s/.test(text)) {
				return text;
			}
			const prefix = ordered ? `${i + 1}. ` : '- ';
			return `${prefix}${text}`;
		})
		.join('\n');
	return <>{`${rendered}\n\n`}</>;
}

export function ListItem({ children }: { children: ReactNode }) {
	return <>{`- ${childrenToString(children)}`}</>;
}

export function Link({ href, children }: { href: string; children: ReactNode }) {
	return <>{`[${childrenToString(children)}](${href})`}</>;
}

export function Hr() {
	return <>{`---\n\n`}</>;
}

export function Blockquote({ children }: { children: ReactNode }) {
	const text = childrenToString(children).trimEnd();
	const quoted = text
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n');
	return <>{`${quoted}\n\n`}</>;
}

export function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
	const headerRow = `| ${headers.join(' | ')} |`;
	const separator = `| ${headers.map(() => '---').join(' | ')} |`;
	const dataRows = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
	return <>{`${headerRow}\n${separator}\n${dataRows}\n\n`}</>;
}
