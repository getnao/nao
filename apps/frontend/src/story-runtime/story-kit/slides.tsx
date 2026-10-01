import { joinClassNames } from '@nao/shared/class-names';
import { STORY_PRINT_SLIDES_ATTRIBUTE, STORY_SLIDE_SIZE } from '@nao/shared/story-app';
import { ChevronLeftIcon, ChevronRightIcon, MaximizeIcon, MinimizeIcon } from 'lucide-react';
import { Children, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isPrintMode } from '../story-host';
import type { CSSProperties, ReactNode, RefObject } from 'react';

const SLIDE_FRAME_BORDER_PX = 1;
const CONTROLS_IDLE_DELAY_MS = 2000;
const IDLE_ATTRIBUTE = 'data-idle';

export interface SlidesProps {
	children: ReactNode;
	title?: ReactNode;
	eyebrow?: ReactNode;
	className?: string;
}

export interface SlideProps {
	children: ReactNode;
	title?: ReactNode;
	eyebrow?: ReactNode;
	className?: string;
	style?: CSSProperties;
}

interface SlideDeckProps {
	slides: ReactNode[];
	title?: ReactNode;
	eyebrow?: ReactNode;
	className?: string;
}

interface SlideToolbarProps {
	current: number;
	count: number;
	goTo: (index: number) => void;
	fullscreen: Fullscreen;
}

interface Fullscreen {
	active: boolean;
	toggle: () => void;
	exit: () => void;
}

/** A deck: one slide at a time on screen, one slide per page once printed. */
export function Slides({ children, title, eyebrow, className }: SlidesProps) {
	const slides = Children.toArray(children);
	if (isPrintMode()) {
		return <PrintedSlides slides={slides} />;
	}
	return <SlideDeck slides={slides} title={title} eyebrow={eyebrow} className={className} />;
}

export function Slide({ children, title, eyebrow, className, style }: SlideProps) {
	return (
		<div className={joinClassNames('nao-slide', className)} style={style}>
			{(title || eyebrow) && (
				<header className='nao-slide__heading'>
					{eyebrow && <div className='nao-slide__eyebrow'>{eyebrow}</div>}
					{title && <h2 className='nao-slide__title'>{title}</h2>}
				</header>
			)}
			{children}
		</div>
	);
}

function SlideDeck({ slides, title, eyebrow, className }: SlideDeckProps) {
	const [index, setIndex] = useState(0);
	const lastIndex = Math.max(slides.length - 1, 0);
	const current = Math.min(index, lastIndex);
	const goTo = useCallback((next: number) => setIndex(Math.min(Math.max(next, 0), lastIndex)), [lastIndex]);
	const { rootRef, fullscreen } = useFullscreen();
	useKeyboardShortcuts(current, goTo, fullscreen);
	const { stageRef, scale } = useSlideFit();
	useIdleControls(rootRef, fullscreen.active);

	return (
		<div
			ref={rootRef}
			className={joinClassNames('nao-slides', fullscreen.active && 'nao-slides--fullscreen', className)}
		>
			<div className='nao-slides__top'>
				{(title || eyebrow) && (
					<header className='nao-slides__header'>
						{eyebrow && <div className='nao-slides__eyebrow'>{eyebrow}</div>}
						{title && <h1 className='nao-slides__title'>{title}</h1>}
					</header>
				)}
				<SlideToolbar current={current} count={slides.length} goTo={goTo} fullscreen={fullscreen} />
			</div>
			<div ref={stageRef} className='nao-slides__stage'>
				<div
					className='nao-slides__viewport'
					style={
						{
							width: STORY_SLIDE_SIZE.width * scale,
							height: STORY_SLIDE_SIZE.height * scale,
							'--nao-slide-scale': scale,
						} as CSSProperties
					}
				>
					{slides[current]}
				</div>
			</div>
		</div>
	);
}

function SlideToolbar({ current, count, goTo, fullscreen }: SlideToolbarProps) {
	return (
		<nav className='nao-slides__toolbar'>
			{count > 1 && (
				<div className='nao-slides__pager'>
					<button
						type='button'
						className='nao-slides__control'
						onClick={() => goTo(current - 1)}
						disabled={current === 0}
						aria-label='Previous slide'
					>
						<ChevronLeftIcon />
					</button>
					<span className='nao-slides__counter'>
						{current + 1} / {count}
					</span>
					<button
						type='button'
						className='nao-slides__control'
						onClick={() => goTo(current + 1)}
						disabled={current === count - 1}
						aria-label='Next slide'
					>
						<ChevronRightIcon />
					</button>
				</div>
			)}
			<FullscreenButton fullscreen={fullscreen} />
		</nav>
	);
}

function FullscreenButton({ fullscreen }: { fullscreen: Fullscreen }) {
	const label = fullscreen.active ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)';
	return (
		<button
			type='button'
			className='nao-slides__control'
			onClick={fullscreen.toggle}
			title={label}
			aria-label={label}
			aria-pressed={fullscreen.active}
		>
			{fullscreen.active ? <MinimizeIcon /> : <MaximizeIcon />}
		</button>
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

/**
 * Slides are laid out on the fixed print canvas and scaled to fit the stage in both directions, so the whole slide is
 * visible without scrolling and screen matches PDF.
 */
function useSlideFit() {
	const stageRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);

	useLayoutEffect(() => {
		const stage = stageRef.current;
		if (!stage) {
			return;
		}
		const fit = () => {
			const width = stage.clientWidth - 2 * SLIDE_FRAME_BORDER_PX;
			const height = stage.clientHeight - 2 * SLIDE_FRAME_BORDER_PX;
			setScale(Math.max(Math.min(width / STORY_SLIDE_SIZE.width, height / STORY_SLIDE_SIZE.height), 0));
		};
		const observer = new ResizeObserver(fit);
		observer.observe(stage);
		return () => observer.disconnect();
	}, []);

	return { stageRef, scale };
}

function useFullscreen(): { rootRef: RefObject<HTMLDivElement | null>; fullscreen: Fullscreen } {
	const rootRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(false);

	useEffect(() => {
		const syncWithDocument = () => {
			const root = rootRef.current;
			setActive(root !== null && document.fullscreenElement === root);
		};
		document.addEventListener('fullscreenchange', syncWithDocument);
		return () => document.removeEventListener('fullscreenchange', syncWithDocument);
	}, []);

	const enter = useCallback(() => {
		const root = rootRef.current;
		if (root && document.fullscreenEnabled) {
			root.requestFullscreen().catch(() => setActive(true));
		} else {
			setActive(true);
		}
	}, []);

	const exit = useCallback(() => {
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			setActive(false);
		}
	}, []);

	const toggle = useCallback(() => (active ? exit() : enter()), [active, enter, exit]);
	const fullscreen = useMemo(() => ({ active, toggle, exit }), [active, toggle, exit]);

	return { rootRef, fullscreen };
}

function useIdleControls(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
	useEffect(() => {
		const root = rootRef.current;
		if (!enabled || !root) {
			return;
		}
		let timeout: number | null = null;
		const clearTimer = () => {
			if (timeout !== null) {
				window.clearTimeout(timeout);
				timeout = null;
			}
		};
		const sleep = () => {
			clearTimer();
			root.setAttribute(IDLE_ATTRIBUTE, '');
		};
		const wake = () => {
			clearTimer();
			root.removeAttribute(IDLE_ATTRIBUTE);
			timeout = window.setTimeout(sleep, CONTROLS_IDLE_DELAY_MS);
		};
		root.addEventListener('mousemove', wake);
		root.addEventListener('mouseleave', sleep);
		wake();
		return () => {
			clearTimer();
			root.removeEventListener('mousemove', wake);
			root.removeEventListener('mouseleave', sleep);
			root.removeAttribute(IDLE_ATTRIBUTE);
		};
	}, [rootRef, enabled]);
}

function useKeyboardShortcuts(current: number, goTo: (index: number) => void, fullscreen: Fullscreen) {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}
			if (event.key === 'ArrowRight' || event.key === 'PageDown') {
				goTo(current + 1);
			} else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
				goTo(current - 1);
			} else if (event.key === 'f' || event.key === 'F') {
				fullscreen.toggle();
			} else if (event.key === 'Escape' && fullscreen.active) {
				fullscreen.exit();
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [current, goTo, fullscreen]);
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
	);
}
