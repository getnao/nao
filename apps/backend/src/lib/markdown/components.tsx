import { cloneElement, ReactElement, ReactNode } from 'react';

/** Render a block with each child separated with one line by default. */
export function Block({
	children,
	separator = '\n\n',
	prefix = '',
	indent,
}: {
	children: ReactNode;
	separator?: string;
	prefix?: string;
	indent?: string;
}) {
	return (
		<div data-separator={separator} data-indent={indent} data-prefix={prefix}>
			{children}
		</div>
	);
}

export function Title({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
	return (
		<Span>
			{`#`.repeat(level) + ' '}
			{children}
		</Span>
	);
}

/** Render an inline block. */
export function Span({ children }: { children: ReactNode }) {
	return <Block separator=''>{children}</Block>;
}

export function CodeBlock({ children, header }: { children: ReactNode; header?: string | string[] }) {
	return (
		<Block separator={'\n'}>
			{'```' + (Array.isArray(header) ? header.join(' ') : (header ?? ''))}
			{children}
			{'```'}
		</Block>
	);
}

export function Link({ href, text }: { href: string; text: ReactNode }) {
	return (
		<Span>
			[{text}]({href})
		</Span>
	);
}

export function Bold({ children }: { children: ReactNode }) {
	return <Span>**{children}**</Span>;
}

export function Italic({ children }: { children: ReactNode }) {
	return <Span>*{children}*</Span>;
}

export function Code({ children }: { children: ReactNode }) {
	return <Span>`{children}`</Span>;
}

export function Br() {
	return '\n';
}

export function Hr() {
	return '---';
}

export function List({ children, ordered, indent = 0 }: { children: ReactNode; ordered?: boolean; indent?: number }) {
	const items: ReactNode[] = (Array.isArray(children) ? children : [children]).filter(isRenderable);
	return (
		<Block separator={'\n'}>
			{items.map((child, i) => {
				const isElement = typeof child === 'object' && child !== null && 'type' in child;
				const isListItem = isElement && child.type === ListItem;
				const isSubList = isElement && child.type === List;

				const rendered = isSubList
					? cloneElement(child as ReactElement<{ indent?: number }>, { indent: indent + 1 })
					: child;

				return (
					<Span>
						{'\t'.repeat(indent)}
						{isListItem ? (ordered ? `${i + 1}. ` : '- ') : null}
						{rendered}
					</Span>
				);
			})}
		</Block>
	);
}

export function ListItem({ children }: { children: ReactNode }) {
	return <Span>{children}</Span>;
}

export function TitledList({ title, children, maxItems }: { title: string; children: ReactNode; maxItems?: number }) {
	const items = Array.isArray(children) ? children : [children];
	const slicedItems = maxItems ? items.slice(0, maxItems) : items;
	const isSliced = slicedItems.length < items.length;
	return (
		<Block separator={'\n'}>
			<Span>{title}:</Span>
			<List>{slicedItems}</List>
			{isSliced && `...(${items.length - slicedItems.length} more)`}
		</Block>
	);
}

export function Location({ children }: { children: ReactNode }) {
	return <Span>**Location:** `{children}`</Span>;
}

export function XML({ tag, props, children }: { tag: string; props?: Record<string, string>; children: ReactNode }) {
	const propsString = props
		? Object.entries(props)
				.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
				.join(' ')
		: '';

	return (
		<Block separator={'\n'}>
			<Span>{`<${tag}${propsString ? ` ${propsString}` : ''}>`}</Span>
			<Block separator={'\n'} indent={'\t'}>
				{children}
			</Block>
			<Span>{`</${tag}>`}</Span>
		</Block>
	);
}

export const isRenderable = (node: ReactNode): boolean => {
	return !(node == null || typeof node === 'boolean');
};
