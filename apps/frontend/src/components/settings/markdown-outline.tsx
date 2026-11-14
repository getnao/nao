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
const NO_HEADINGS: OutlineHeading[] = [];
const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

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
		selector: ({ editor: currentEditor }) => {
			return currentEditor ? readOutlineHeadings(currentEditor) : NO_HEADINGS;
		},
		equalityFn: areSameHeadings,
	});
	const { activeIndex, pinActiveIndex } = useActiveHeadingIndex(editor, headings ?? NO_HEADINGS, scrollContainerRef);

	const selectHeading = useCallback(
		(index: number) => {
			const container = scrollContainerRef.current;
			const heading = headings?.[index];
			const element = editor && heading && getHeadingElement(editor, heading);
			if (!container || !element) {
				return;
			}
			pinActiveIndex(index);
			container.scrollTo({ top: getOffsetInContainer(container, element) - SCROLL_MARGIN, behavior: 'smooth' });
		},
		[editor, headings, pinActiveIndex, scrollContainerRef],
	);

	if (!headings || headings.length < MINIMUM_HEADING_COUNT) {
		return null;
	}

	return (
		<nav aria-label='Outline' className='group pointer-events-none absolute top-6 right-4 bottom-6 z-10'>
			<ul
				className={cn(
					'flex max-h-full w-64 flex-col overflow-x-hidden overflow-y-auto overscroll-contain py-1 [scrollbar-width:none]',
					'group-hover:pointer-events-auto group-has-focus-visible:pointer-events-auto',
				)}
			>
				{headings.map((heading, index) => (
					<OutlineItem
						key={heading.position}
						heading={heading}
						index={index}
						isActive={index === activeIndex}
						onSelect={selectHeading}
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
	onSelect: (index: number) => void;
}

/**
 * A mark that spreads out on hover of the outline, revealing its heading title on its left. Only the mark catches the
 * pointer until the outline opens, so the hidden title never opens it from the editor text.
 */
function OutlineItem({ heading, index, isActive, onSelect }: OutlineItemProps) {
	const revealDelay = `${Math.min(index * REVEAL_STAGGER_MS, MAXIMUM_REVEAL_DELAY_MS)}ms`;

	return (
		<li className='flex h-2.5 shrink-0 transition-[height] duration-300 ease-out group-has-focus-visible:h-6 group-hover:h-6'>
			<button
				type='button'
				aria-current={isActive ? 'location' : undefined}
				onClick={() => {
					onSelect(index);
				}}
				className={cn(
					'group/item pointer-events-none flex h-full w-full cursor-pointer items-center outline-none',
					'group-hover:pointer-events-auto group-has-focus-visible:pointer-events-auto',
				)}
			>
				<span
					style={{ transitionDelay: revealDelay }}
					className={cn(
						'min-w-0 flex-1 translate-x-2 truncate pr-2 text-right text-xs opacity-0 transition-[opacity,translate,color] duration-300 ease-out',
						'group-hover:translate-x-0 group-hover:opacity-100 group-has-focus-visible:translate-x-0 group-has-focus-visible:opacity-100',
						'group-hover/item:text-foreground group-focus-visible/item:text-foreground',
						isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
					)}
				>
					{heading.text}
				</span>
				<span className='pointer-events-auto flex h-full w-7 shrink-0 items-center justify-end'>
					<span
						className={cn(
							'h-0.5 rounded-full transition-all duration-300 ease-out',
							heading.level === 1
								? 'w-4 group-hover:w-5 group-has-focus-visible:w-5'
								: 'w-2.5 group-hover:w-3.5 group-has-focus-visible:w-3.5',
							'group-hover/item:bg-foreground group-focus-visible/item:bg-foreground',
							isActive ? 'bg-foreground' : 'bg-muted-foreground/30',
						)}
					/>
				</span>
			</button>
		</li>
	);
}

function readOutlineHeadings(editor: Editor): OutlineHeading[] {
	const headings: OutlineHeading[] = [];
	editor.state.doc.descendants((node, position) => {
		if (node.type.name !== 'heading') {
			return true;
		}
		const level = node.attrs.level as number;
		const text = node.textContent.trim();
		if (OUTLINE_LEVELS.has(level) && text) {
			headings.push({ level, text, position });
		}
		return false;
	});
	return headings;
}

/**
 * The heading being read, following the scroll. A picked heading stays active until the user scrolls or clicks in the
 * editor, or the headings change, since the editor cannot always scroll it to the top, like in a short file or near
 * its end.
 */
function useActiveHeadingIndex(
	editor: Editor | null,
	headings: OutlineHeading[],
	scrollContainerRef: RefObject<HTMLElement | null>,
): { activeIndex: number; pinActiveIndex: (index: number) => void } {
	const [scrolledIndex, setScrolledIndex] = useState(0);
	const [pin, setPin] = useState<{ index: number; headings: OutlineHeading[] } | null>(null);
	const pinnedIndex = pin?.headings === headings ? pin.index : null;

	useEffect(() => {
		const container = scrollContainerRef.current;
		if (!editor || !container) {
			return;
		}
		const updateScrolledIndex = () => {
			setScrolledIndex(findActiveHeadingIndex(editor, headings, container));
		};
		updateScrolledIndex();
		container.addEventListener('scroll', updateScrolledIndex, { passive: true });
		return () => {
			container.removeEventListener('scroll', updateScrolledIndex);
		};
	}, [editor, headings, scrollContainerRef]);

	useEffect(() => {
		const container = scrollContainerRef.current;
		if (pinnedIndex === null || !container) {
			return;
		}
		const unpin = () => {
			setPin(null);
		};
		USER_SCROLL_EVENTS.forEach((eventName) => {
			container.addEventListener(eventName, unpin, { passive: true });
		});
		return () => {
			USER_SCROLL_EVENTS.forEach((eventName) => {
				container.removeEventListener(eventName, unpin);
			});
		};
	}, [pinnedIndex, scrollContainerRef]);

	const pinActiveIndex = useCallback(
		(index: number) => {
			setPin({ index, headings });
		},
		[headings],
	);

	return { activeIndex: pinnedIndex ?? scrolledIndex, pinActiveIndex };
}

/**
 * The last heading scrolled past the top of the container, or the first one before any is reached. Once scrolled to
 * the bottom, the final heading may never reach the top, so it becomes the active one.
 */
function findActiveHeadingIndex(editor: Editor, headings: OutlineHeading[], container: HTMLElement): number {
	const isScrolledToBottom =
		container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
	if (isScrolledToBottom) {
		return headings.length - 1;
	}
	const threshold = container.scrollTop + SCROLL_MARGIN * 2;
	let activeIndex = 0;
	headings.forEach((heading, index) => {
		const element = getHeadingElement(editor, heading);
		if (element && getOffsetInContainer(container, element) <= threshold) {
			activeIndex = index;
		}
	});
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
