import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

const CHAT_INPUT_BORDER_STROKE = 1;

/** Static, the border is shown at once in its focused colors instead of being drawn in. */
export function ChatInputAnimatedBorder({ isStatic = false }: { isStatic?: boolean }) {
	const containerRef = useRef<HTMLSpanElement>(null);
	const gradientId = useId();
	const [{ width, height, radius }, setGeometry] = useState({ width: 0, height: 0, radius: 0 });
	const [isFocused, setIsFocused] = useState(false);

	useLayoutEffect(() => {
		const element = containerRef.current;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			setGeometry({
				width: entry.contentRect.width,
				height: entry.contentRect.height,
				radius: readBorderRadius(element.parentElement),
			});
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const parent = containerRef.current?.parentElement;
		if (!parent) {
			return;
		}
		const handleFocusIn = () => setIsFocused(true);
		const handleFocusOut = (event: FocusEvent) => {
			const nextTarget = event.relatedTarget as Node | null;
			if (nextTarget && parent.contains(nextTarget)) {
				return;
			}
			setIsFocused(false);
		};
		setIsFocused(parent.contains(document.activeElement));
		parent.addEventListener('focusin', handleFocusIn);
		parent.addEventListener('focusout', handleFocusOut);
		return () => {
			parent.removeEventListener('focusin', handleFocusIn);
			parent.removeEventListener('focusout', handleFocusOut);
		};
	}, []);

	const hasSize = width > 0 && height > 0;
	const inset = CHAT_INPUT_BORDER_STROKE / 2;
	const strokeRadius = Math.max(Math.min(radius, width / 2, height / 2) - inset, 0);
	const isHighlighted = isStatic || isFocused;
	const strokeColor = isHighlighted ? 'var(--primary)' : 'var(--muted-foreground)';

	return (
		<span ref={containerRef} aria-hidden='true' className='pointer-events-none absolute inset-0 z-10'>
			{hasSize && (
				<svg
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					fill='none'
					className='block overflow-visible'
				>
					<defs>
						<linearGradient id={gradientId} x1='0%' y1='0%' x2='0%' y2='100%'>
							<stop
								className='chat-input-border-stop'
								offset='0%'
								style={{ stopColor: strokeColor, stopOpacity: isHighlighted ? 0.35 : 0.25 }}
							/>
							<stop
								className='chat-input-border-stop'
								offset='100%'
								style={{ stopColor: strokeColor, stopOpacity: isHighlighted ? 1 : 0.4 }}
							/>
						</linearGradient>
					</defs>
					<rect
						className={isStatic ? undefined : 'chat-input-border-path'}
						x={inset}
						y={inset}
						width={width - CHAT_INPUT_BORDER_STROKE}
						height={height - CHAT_INPUT_BORDER_STROKE}
						rx={strokeRadius}
						ry={strokeRadius}
						pathLength={100}
						stroke={`url(#${gradientId})`}
						strokeWidth={CHAT_INPUT_BORDER_STROKE}
						strokeLinecap='round'
					/>
				</svg>
			)}
		</span>
	);
}

function readBorderRadius(element: HTMLElement | null): number {
	if (!element) {
		return 0;
	}
	const value = getComputedStyle(element).borderTopLeftRadius;
	if (value.includes('infinity')) {
		return Number.POSITIVE_INFINITY;
	}
	const radius = parseFloat(value);
	return Number.isFinite(radius) ? radius : 0;
}
