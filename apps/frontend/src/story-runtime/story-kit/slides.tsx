import { joinClassNames } from '@nao/shared/class-names';
import { STORY_PRINT_SLIDES_ATTRIBUTE, STORY_SLIDE_SIZE } from '@nao/shared/story-app';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isPrintMode } from '../story-host';
import type { CSSProperties, ReactNode } from 'react';

export interface SlidesProps {
	children: ReactNode;
	className?: string;
}

export interface SlideProps {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}

/** A deck: one slide at a time on screen, one slide per page once printed. */
export function Slides({ children, className }: SlidesProps) {
	const slides = Children.toArray(children);
	if (isPrintMode()) {
		return <PrintedSlides slides={slides} />;
	}
	return <SlideDeck slides={slides} className={className} />;
}

export function Slide({ children, className, style }: SlideProps) {
	return (
		<div className={joinClassNames('nao-slide', className)} style={style}>
			{children}
		</div>
	);
}

function SlideDeck({ slides, className }: { slides: ReactNode[]; className?: string }) {
	const [index, setIndex] = useState(0);
	const lastIndex = Math.max(slides.length - 1, 0);
	const current = Math.min(index, lastIndex);
	const goTo = useCallback((next: number) => setIndex(Math.min(Math.max(next, 0), lastIndex)), [lastIndex]);
	useArrowKeys(current, goTo);
	const { viewportRef, scale } = useSlideScale();

	return (
		<div className={joinClassNames('nao-slides', className)}>
			<div
				ref={viewportRef}
				className='nao-slides__viewport'
				style={{ height: STORY_SLIDE_SIZE.height * scale, '--nao-slide-scale': scale } as CSSProperties}
			>
				{slides[current]}
			</div>
			{slides.length > 1 && (
				<nav className='nao-slides__nav'>
					<button
						type='button'
						onClick={() => goTo(current - 1)}
						disabled={current === 0}
						aria-label='Previous slide'
					>
						<ChevronLeftIcon />
					</button>
					<span className='nao-slides__counter'>
						{current + 1} / {slides.length}
					</span>
					<button
						type='button'
						onClick={() => goTo(current + 1)}
						disabled={current === lastIndex}
						aria-label='Next slide'
					>
						<ChevronRightIcon />
					</button>
				</nav>
			)}
		</div>
	);
}

/** Printed outside the story's own layout, so its paddings and wrappers cannot shift slides across page breaks. */
function PrintedSlides({ slides }: { slides: ReactNode[] }) {
	useLayoutEffect(() => {
		document.documentElement.setAttribute(STORY_PRINT_SLIDES_ATTRIBUTE, '');
		return () => document.documentElement.removeAttribute(STORY_PRINT_SLIDES_ATTRIBUTE);
	}, []);
	return createPortal(<div className='nao-slides nao-slides--print'>{slides}</div>, document.body);
}

/** Slides are laid out on the fixed print canvas and scaled down to the available width, so screen and PDF match. */
function useSlideScale() {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}
		const observer = new ResizeObserver(() => setScale(viewport.clientWidth / STORY_SLIDE_SIZE.width));
		observer.observe(viewport);
		return () => observer.disconnect();
	}, []);

	return { viewportRef, scale };
}

function useArrowKeys(current: number, goTo: (index: number) => void) {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isEditableTarget(event.target)) {
				return;
			}
			if (event.key === 'ArrowRight' || event.key === 'PageDown') {
				goTo(current + 1);
			} else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
				goTo(current - 1);
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [current, goTo]);
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
	);
}
