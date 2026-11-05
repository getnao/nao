import { createContext, useContext, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';

import type { RunFilters } from '@/components/settings/test-run-filter-menu';
import { RunFilterMenu } from '@/components/settings/test-run-filter-menu';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';

const DEFAULT_RUNS_COLUMN_WIDTH = 224;
const MIN_RUNS_COLUMN_WIDTH = 160;
const MAX_RUNS_COLUMN_WIDTH = 520;
const RUNS_COLUMN_KEYBOARD_STEP = 16;
const runsColumnWidthStorage = createLocalStorage<number>('nao-test-runs-column-width', DEFAULT_RUNS_COLUMN_WIDTH);

interface RunsColumnWidth {
	width: number;
	setWidth: (width: number, options?: { persist?: boolean }) => void;
}

/** The width of the runs column of the drawer panes, shared with the "All tests" tab so their edges line up. */
export const RunsColumnWidthContext = createContext<RunsColumnWidth>({
	width: DEFAULT_RUNS_COLUMN_WIDTH,
	setWidth: () => {},
});

export function useRunsColumnWidthState(): RunsColumnWidth {
	const [width, setWidth] = useLocalStorage(runsColumnWidthStorage);
	return { width: clampRunsColumnWidth(width), setWidth };
}

/** The column listing the runs, which the user widens or narrows by dragging its right edge. */
export function RunsColumn({ label, children }: { label?: string; children: ReactNode }) {
	const { width } = useContext(RunsColumnWidthContext);
	const Element = label ? 'nav' : 'div';
	return (
		<div className='relative flex shrink-0 border-r' style={{ width }}>
			<Element aria-label={label} className='flex min-w-0 flex-1 flex-col overflow-y-auto text-xs'>
				{children}
			</Element>
			<RunsColumnResizeHandle />
		</div>
	);
}

/** The header row of each pane, all of the same height so their bottom borders line up across the drawer. */
export function PanelHeader({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div
			className={cn(
				'sticky top-0 z-10 flex min-h-9 shrink-0 items-center border-b bg-background px-3 py-1 text-muted-foreground',
				className,
			)}
		>
			{children}
		</div>
	);
}

export function RecentRunsHeader({
	filters,
	onChange,
}: {
	filters: RunFilters;
	onChange: (filters: RunFilters) => void;
}) {
	return (
		<PanelHeader>
			<span className='text-[10px] font-medium tracking-wide uppercase'>Recent runs</span>
			<RunFilterMenu filters={filters} onChange={onChange} />
		</PanelHeader>
	);
}

/**
 * Dragging resizes the column, saved once released, as do the arrow keys, Home and End once focused; a double click or
 * Enter brings back its default width.
 */
function RunsColumnResizeHandle() {
	const { width, setWidth } = useContext(RunsColumnWidthContext);
	const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

	const startDrag = (event: PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { startX: event.clientX, startWidth: width, width };
	};

	const drag = (event: PointerEvent<HTMLDivElement>) => {
		const current = dragRef.current;
		if (!current) {
			return;
		}
		current.width = clampRunsColumnWidth(current.startWidth + event.clientX - current.startX);
		setWidth(current.width, { persist: false });
	};

	const endDrag = () => {
		if (dragRef.current) {
			setWidth(dragRef.current.width);
			dragRef.current = null;
		}
	};

	const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
		const nextWidth = getKeyboardWidth(event.key, width);
		if (nextWidth !== null) {
			event.preventDefault();
			setWidth(nextWidth);
		}
	};

	return (
		<div
			role='separator'
			aria-orientation='vertical'
			aria-label='Resize the runs column'
			aria-valuenow={width}
			aria-valuemin={MIN_RUNS_COLUMN_WIDTH}
			aria-valuemax={MAX_RUNS_COLUMN_WIDTH}
			tabIndex={0}
			className='absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none transition-colors outline-none hover:bg-primary/20 focus-visible:bg-primary/40'
			onKeyDown={resizeWithKeyboard}
			onPointerDown={startDrag}
			onPointerMove={drag}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onDoubleClick={() => setWidth(DEFAULT_RUNS_COLUMN_WIDTH)}
		/>
	);
}

function getKeyboardWidth(key: string, width: number): number | null {
	switch (key) {
		case 'ArrowLeft':
			return clampRunsColumnWidth(width - RUNS_COLUMN_KEYBOARD_STEP);
		case 'ArrowRight':
			return clampRunsColumnWidth(width + RUNS_COLUMN_KEYBOARD_STEP);
		case 'Home':
			return MIN_RUNS_COLUMN_WIDTH;
		case 'End':
			return MAX_RUNS_COLUMN_WIDTH;
		case 'Enter':
			return DEFAULT_RUNS_COLUMN_WIDTH;
		default:
			return null;
	}
}

function clampRunsColumnWidth(width: number): number {
	return Math.min(Math.max(width, MIN_RUNS_COLUMN_WIDTH), MAX_RUNS_COLUMN_WIDTH);
}
