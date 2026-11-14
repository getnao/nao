import { useEditorState } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { RefObject } from 'react';

import { cn } from '@/lib/utils';

const OUTLINE_LEVELS = new Set([1, 2]);
const MINIMUM_HEADING_COUNT = 2;
const SCROLL_MARGIN = 16;
const REVEAL_STAGGER_MS = 20;
const MAXIMUM_REVEAL_DELAY_MS = 200;

interface OutlineHeading {
	level: number;
	text: string;
	position: number;
}

interface MarkdownOutlineProps {
	editor: Editor | null;
	scrollContainerRef: RefObject<HTMLElement | null>;
}

/**
 * A discreet outline of the H1 and H2 headings, drawn as short marks on the right edge. Hovering it spreads the marks
 * and reveals the heading titles, and picking one scrolls the editor to it.
 */
export function MarkdownOutline({ editor, scrollContainerRef }: MarkdownOutlineProps) {
	const headings = useEditorState({
		editor,
		selector: ({ editor: currentEditor }) => (currentEditor ? readOutlineHeadings(currentEditor) : []),
		equalityFn: areSameHeadings,
	});
	const activeIndex = useActiveHeadingIndex(editor, headings ?? [], scrollContainerRef);

	const scrollToHeading = useCallback(
		(heading: OutlineHeading) => {
			const container = scrollContainerRef.current;
			const element = editor && getHeadingElement(editor, heading);
			if (!container || !element) {
				return;
			}
			container.scrollTo({ top: getOffsetInContainer(container, element) - SCROLL_MARGIN, behavior: 'smooth' });
		},
		[editor, scrollContainerRef],
	);

	if (!headings || headings.length < MINIMUM_HEADING_COUNT) {
		return null;
	}

	return (
		<nav aria-label='Outline' className='group absolute top-6 right-4 z-10'>
			<ul className='flex flex-col py-1'>
				{headings.map((heading, index) => (
					<OutlineItem
						key={heading.position}
						heading={heading}
						index={index}
						isActive={index === activeIndex}
						onSelect={scrollToHeading}
					/>
				))}
			</ul>
		</nav>
	);
}

interface OutlineItemProps {
	heading: OutlineHeading;
	index: number;
	isActive: boolean;
	onSelect: (heading: OutlineHeading) => void;
}

/** A mark that spreads out on hover of the outline, revealing its heading title on its left. */
function OutlineItem({ heading, index, isActive, onSelect }: OutlineItemProps) {
	const revealDelay = `${Math.min(index * REVEAL_STAGGER_MS, MAXIMUM_REVEAL_DELAY_MS)}ms`;

	return (
		<li className='flex h-2.5 justify-end transition-[height] duration-300 ease-out group-has-focus-visible:h-6 group-hover:h-6'>
			<button
				type='button'
				aria-current={isActive ? 'location' : undefined}
				onClick={() => onSelect(heading)}
				className='group/item relative flex h-full w-7 cursor-pointer items-center justify-end outline-none'
			>
				<span
					style={{ transitionDelay: revealDelay }}
					className={cn(
						'pointer-events-none absolute top-0 right-full h-full w-56 translate-x-2 truncate pr-2 text-right text-xs leading-6 whitespace-nowrap opacity-0 transition-[opacity,translate,color] duration-300 ease-out',
						'group-has-focus-visible:pointer-events-auto group-has-focus-visible:translate-x-0 group-has-focus-visible:opacity-100',
						'group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100',
						'group-hover/item:text-foreground group-focus-visible/item:text-foreground',
						isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
					)}
				>
					{heading.text}
				</span>
				<span
					className={cn(
						'h-0.5 shrink-0 rounded-full transition-all duration-300 ease-out',
						heading.level === 1
							? 'w-4 group-has-focus-visible:w-5 group-hover:w-5'
							: 'w-2.5 group-has-focus-visible:w-3.5 group-hover:w-3.5',
						'group-hover/item:bg-foreground group-focus-visible/item:bg-foreground',
						isActive ? 'bg-foreground' : 'bg-muted-foreground/30',
					)}
				/>
			</button>
		</li>
	);
}

function readOutlineHeadings(editor: Editor): OutlineHeading[] {
	const headings: OutlineHeading[] = [];
	editor.state.doc.forEach((node, position) => {
		const level = node.attrs.level as number;
		const text = node.textContent.trim();
		if (node.type.name === 'heading' && OUTLINE_LEVELS.has(level) && text) {
			headings.push({ level, text, position });
		}
	});
	return headings;
}

/** The last heading scrolled past the top of the container, or the first one before any is reached. */
function useActiveHeadingIndex(
	editor: Editor | null,
	headings: OutlineHeading[],
	scrollContainerRef: RefObject<HTMLElement | null>,
): number {
	const [activeIndex, setActiveIndex] = useState(0);

	useEffect(() => {
		const container = scrollContainerRef.current;
		if (!editor || !container) {
			return;
		}
		const updateActiveIndex = () => {
			const threshold = container.scrollTop + SCROLL_MARGIN * 2;
			let index = 0;
			headings.forEach((heading, headingIndex) => {
				const element = getHeadingElement(editor, heading);
				if (element && getOffsetInContainer(container, element) <= threshold) {
					index = headingIndex;
				}
			});
			setActiveIndex(index);
		};
		updateActiveIndex();
		container.addEventListener('scroll', updateActiveIndex, { passive: true });
		return () => container.removeEventListener('scroll', updateActiveIndex);
	}, [editor, headings, scrollContainerRef]);

	return activeIndex;
}

function getHeadingElement(editor: Editor, heading: OutlineHeading): HTMLElement | null {
	const node = editor.view.nodeDOM(heading.position);
	return node instanceof HTMLElement ? node : null;
}

function getOffsetInContainer(container: HTMLElement, element: HTMLElement): number {
	return element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

function areSameHeadings(previous: OutlineHeading[] | null, next: OutlineHeading[] | null): boolean {
	if (!previous || !next || previous.length !== next.length) {
		return previous === next;
	}
	return previous.every(
		(heading, index) =>
			heading.level === next[index].level &&
			heading.text === next[index].text &&
			heading.position === next[index].position,
	);
}
