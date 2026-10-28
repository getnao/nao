import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent, PointerEvent, ReactNode, RefObject } from 'react';
import type { StoryElementAsk } from '@nao/shared/story-app';

import { cn } from '@/lib/utils';
import { STORY_HIGHLIGHT_TTL_MS, useStoryHighlightRequest } from '@/stores/story-highlight';
import { describeElement, findInspectableElement } from '@/story-runtime/story-elements';
import { highlightStoryElement } from '@/story-runtime/story-highlight';

const STORY_OVERLAY_Z_INDEX = 10;

interface StoryElementPickerProps {
	isPicking: boolean;
	storySlug?: string;
	onPick: (ask: StoryElementAsk) => void;
	children: ReactNode;
}

export function StoryElementPicker({ isPicking, storySlug, onPick, children }: StoryElementPickerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [pointedElement, setPointedElement] = useState<Element | null>(null);
	const hovered = isPicking ? pointedElement : null;
	useCitedElementHighlight(containerRef, storySlug);

	const findPickable = (target: EventTarget | null) => {
		const element = findInspectableElement(target);
		const isInStory = element && containerRef.current?.contains(element);
		return isInStory && !element.closest('[data-selection-ignore]') ? element : null;
	};

	const handlePointerOver = (event: PointerEvent) => {
		setPointedElement(findPickable(event.target));
	};

	/** A click picks the element instead of reaching the story's own handlers, such as links or chart legends. */
	const handleClickCapture = (event: MouseEvent) => {
		const element = isPicking && !hasTextSelection() ? findPickable(event.target) : null;
		if (!element) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		onPick(describeElement(element));
	};

	return (
		<div
			ref={containerRef}
			className={cn('contents', isPicking && '[&_*]:cursor-pointer!')}
			onPointerOver={handlePointerOver}
			onPointerLeave={() => setPointedElement(null)}
			onClickCapture={handleClickCapture}
		>
			{children}
			{hovered && <PickOutline element={hovered} />}
		</div>
	);
}

function PickOutline({ element }: { element: Element }) {
	const outlineRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		let frame = 0;
		const follow = () => {
			const outline = outlineRef.current;
			if (outline) {
				placeOver(outline, element.getBoundingClientRect());
			}
			frame = requestAnimationFrame(follow);
		};
		follow();
		return () => cancelAnimationFrame(frame);
	}, [element]);

	return createPortal(
		<div
			ref={outlineRef}
			style={{ zIndex: STORY_OVERLAY_Z_INDEX }}
			className='pointer-events-none fixed rounded-[var(--story-block-radius,6px)] border-[1.5px] border-primary bg-primary/5'
		/>,
		document.body,
	);
}

function useCitedElementHighlight(containerRef: RefObject<HTMLElement | null>, storySlug: string | undefined) {
	const request = useStoryHighlightRequest();
	const handledRequestId = useRef<number | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		const isForThisStory =
			request &&
			(!request.storySlug || !storySlug || request.storySlug === storySlug) &&
			Date.now() - request.requestedAt < STORY_HIGHLIGHT_TTL_MS;
		if (!isForThisStory || !container || handledRequestId.current === request.id) {
			return;
		}
		handledRequestId.current = request.id;
		highlightStoryElement(request.element, { root: container, zIndex: STORY_OVERLAY_Z_INDEX });
	}, [containerRef, request, storySlug]);
}

function placeOver(element: HTMLElement, rect: DOMRect) {
	Object.assign(element.style, {
		top: `${rect.top}px`,
		left: `${rect.left}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	});
}

function hasTextSelection(): boolean {
	return window.getSelection()?.isCollapsed === false;
}
