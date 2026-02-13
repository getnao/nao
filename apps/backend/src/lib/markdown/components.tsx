import { cloneElement, ReactElement, ReactNode } from 'react';

export function Block({ children, separator = '\n\n' }: { children: ReactNode; separator?: string }) {
	return <div data-separator={separator}>{children}</div>;
}

export function Title({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
	return (
		<>
			{`#`.repeat(level) + ' '}
			{children}
		</>
	);
}

export function Span({ children }: { children: ReactNode }) {
	return children;
}

export function CodeBlock({ children, header }: { children: ReactNode; header?: string | string[] }) {
	return (
		<>
			{'```' + (Array.isArray(header) ? header.join(' ') : (header ?? '')) + '\n'}
			{children}
			{'\n```'}
		</>
	);
}

export function Link({ href, text }: { href: string; text: ReactNode }) {
	return (
		<>
			[{text}]({href})
		</>
	);
}

export function Bold({ children }: { children: ReactNode }) {
	return <>**{children}**</>;
}

export function Italic({ children }: { children: ReactNode }) {
	return <>*{children}*</>;
}

export function Code({ children }: { children: ReactNode }) {
	return <>`{children}`</>;
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
					<>
						{'\t'.repeat(indent)}
						{isListItem ? (ordered ? `${i + 1}. ` : '- ') : null}
						{rendered}
					</>
				);
			})}
		</Block>
	);
}

export function ListItem({ children }: { children: ReactNode }) {
	return children;
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
	return <>**Location:** `{children}`</>;
}

export const isRenderable = (node: ReactNode): boolean => {
	return !(node == null || typeof node === 'boolean');
};
