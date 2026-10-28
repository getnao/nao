import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import type { StoryElementAsk } from '@nao/shared/story-app';

import { STORY_OVERLAY_Z_INDEX, useCitedElementHighlight } from '@/hooks/use-cited-element-highlight';
import { cn } from '@/lib/utils';
import { describeElement, findInspectableElement } from '@/story-runtime/story-elements';

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
		const outline = outlineRef.current;
		if (!outline) {
			return;
		}
		const place = () => placeOver(outline, element.getBoundingClientRect());
		const options = { capture: true, passive: true };
		const resizeObserver = new ResizeObserver(place);
		place();
		resizeObserver.observe(element);
		window.addEventListener('scroll', place, options);
		window.addEventListener('resize', place, options);
		return () => {
			resizeObserver.disconnect();
			window.removeEventListener('scroll', place, options);
			window.removeEventListener('resize', place, options);
		};
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
