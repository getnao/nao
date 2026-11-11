import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toExplorerTestPath } from '@nao/shared/test-paths';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import type { CSSProperties, ReactNode, Ref, WheelEvent } from 'react';

import type { TestDefinition } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { cn } from '@/lib/utils';

const TAB_DRAG_ACTIVATION_DISTANCE = 4;

interface DrawerTabDrag {
	nodeRef: (element: HTMLElement | null) => void;
	listeners: ReturnType<typeof useSortable>['listeners'];
	style: CSSProperties;
	isDragging: boolean;
}

export function SortableTestTabs({
	testPaths,
	activeTestPath,
	getLabel,
	renderIcon,
	onSelect,
	onClose,
	onMove,
}: {
	testPaths: string[];
	activeTestPath: string | null;
	getLabel: (testPath: string) => string;
	renderIcon: (testPath: string, icon: ReactNode) => ReactNode;
	onSelect: (testPath: string) => void;
	onClose: (testPath: string) => void;
	onMove: (testPath: string, targetPath: string) => void;
}) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: TAB_DRAG_ACTIVATION_DISTANCE } }),
	);

	const handleDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			onMove(String(active.id), String(over.id));
		}
	};

	return (
		<div className='flex h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden' onWheel={scrollTabsHorizontally}>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[lockToHorizontalAxis]}
				onDragEnd={handleDragEnd}
			>
				<SortableContext items={testPaths} strategy={horizontalListSortingStrategy}>
					{testPaths.map((testPath) => (
						<SortableTestTab
							key={testPath}
							testPath={testPath}
							label={getLabel(testPath)}
							isActive={activeTestPath === testPath}
							renderIcon={(icon) => renderIcon(testPath, icon)}
							onSelect={() => onSelect(testPath)}
							onClose={() => onClose(testPath)}
						/>
					))}
				</SortableContext>
			</DndContext>
		</div>
	);
}

/** A tab of the drawer bar, like an editor tab; tabs that can close show a cross and also close on a middle click. */
export function DrawerTab({
	label,
	leading,
	title,
	width,
	isActive,
	onSelect,
	onClose,
	drag,
}: {
	label: string;
	leading?: ReactNode;
	title?: string;
	width?: number;
	isActive: boolean;
	onSelect: () => void;
	onClose?: () => void;
	drag?: DrawerTabDrag;
}) {
	const tabRef = useRef<HTMLDivElement>(null);
	const setTabRef = useMergedTabRef(tabRef, drag?.nodeRef);

	useEffect(() => {
		if (isActive) {
			tabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		}
	}, [isActive]);

	return (
		<div
			ref={setTabRef}
			style={{ ...drag?.style, width }}
			{...drag?.listeners}
			className={cn(
				'group flex h-full shrink-0 items-center border-r transition-colors',
				isActive
					? 'bg-background text-foreground'
					: 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
				drag?.isDragging && 'relative z-10 cursor-grabbing bg-background shadow-md',
			)}
			onAuxClick={(event) => {
				if (event.button === 1 && onClose) {
					event.preventDefault();
					onClose();
				}
			}}
		>
			{leading}
			<button
				type='button'
				role='tab'
				aria-selected={isActive}
				title={title ?? label}
				onClick={onSelect}
				className={cn(
					'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2',
					leading ? 'pl-0.5' : 'pl-3',
					onClose ? 'pr-1.5' : 'pr-3',
				)}
			>
				<span className='max-w-60 truncate whitespace-nowrap'>{label}</span>
			</button>
			{onClose && (
				<button
					type='button'
					aria-label={`Close ${title}`}
					onClick={onClose}
					className={cn(
						'mr-2 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100',
						isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
					)}
				>
					<X className='size-3' />
				</button>
			)}
		</div>
	);
}

/** Names a test tab after its test: as it is in the editor when shown, else as saved, else after its file. */
export function getTestTabLabel(
	testPath: string,
	tests: TestDefinition[] | undefined,
	shownTestFile: { path: string } | null,
	validation: TestFileValidationState,
): string {
	const editedTestName = shownTestFile?.path === testPath ? validation.validation?.test?.name : undefined;
	const savedTestName = tests?.find((test) => toExplorerTestPath(test.path) === testPath)?.name;
	return editedTestName ?? savedTestName ?? fileName(testPath);
}

function SortableTestTab({
	testPath,
	label,
	isActive,
	renderIcon,
	onSelect,
	onClose,
}: {
	testPath: string;
	label: string;
	isActive: boolean;
	renderIcon: (icon: ReactNode) => ReactNode;
	onSelect: () => void;
	onClose: () => void;
}) {
	const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: testPath });

	return (
		<DrawerTab
			label={label}
			title={testPath}
			leading={renderIcon(
				<FileExplorerIcon name={fileName(testPath)} type='file' path={testPath} className='size-3.5' />,
			)}
			isActive={isActive}
			onSelect={onSelect}
			onClose={onClose}
			drag={{
				nodeRef: setNodeRef,
				listeners,
				style: { transform: CSS.Translate.toString(transform), transition },
				isDragging,
			}}
		/>
	);
}

const lockToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

function useMergedTabRef(
	tabRef: { current: HTMLDivElement | null },
	nodeRef: DrawerTabDrag['nodeRef'] | undefined,
): Ref<HTMLDivElement> {
	return useCallback(
		(element: HTMLDivElement | null) => {
			tabRef.current = element;
			nodeRef?.(element);
		},
		[tabRef, nodeRef],
	);
}

function scrollTabsHorizontally(event: WheelEvent<HTMLDivElement>) {
	if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
		event.currentTarget.scrollLeft += event.deltaY;
	}
}

function fileName(path: string): string {
	return path.split('/').at(-1) ?? path;
}
