import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import type { CSSProperties, ReactNode, Ref, WheelEvent } from 'react';

import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { getFileName } from '@/lib/file-path';
import { cn } from '@/lib/utils';

const TAB_DRAG_ACTIVATION_DISTANCE = 4;

/** The height of a tab bar, which a collapsed panel showing only its tabs takes. */
export const TAB_BAR_HEIGHT = 40;

interface EditorTabDrag {
	nodeRef: (element: HTMLElement | null) => void;
	listeners: ReturnType<typeof useSortable>['listeners'];
	style: CSSProperties;
	isDragging: boolean;
}

interface SortableTabsProps {
	paths: string[];
	activePath: string | null;
	unsavedPath?: string | null;
	getLabel?: (path: string) => string;
	getDescription?: (path: string) => string | undefined;
	renderIcon?: (path: string, icon: ReactNode) => ReactNode;
	onSelect: (path: string) => void;
	onClose: (path: string) => void;
	onMove: (path: string, targetPath: string) => void;
	/** Closing several tabs at once, from the menu of a tab; without it, tabs have no menu. */
	onCloseTabs?: (paths: string[]) => void;
}

export function SortableTabs({
	paths,
	activePath,
	unsavedPath,
	getLabel = getTabFileName,
	getDescription,
	renderIcon = (_path, icon) => icon,
	onSelect,
	onClose,
	onMove,
	onCloseTabs,
}: SortableTabsProps) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: TAB_DRAG_ACTIVATION_DISTANCE } }),
	);

	const handleDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			onMove(String(active.id), String(over.id));
		}
	};

	return (
		<div
			className='flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden'
			onWheel={scrollTabsHorizontally}
		>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[lockToHorizontalAxis]}
				onDragEnd={handleDragEnd}
			>
				<SortableContext items={paths} strategy={horizontalListSortingStrategy}>
					{paths.map((path) => (
						<SortableTab
							key={path}
							path={path}
							label={getLabel(path)}
							description={getDescription?.(path)}
							isActive={activePath === path}
							isUnsaved={unsavedPath === path}
							renderIcon={(icon) => renderIcon(path, icon)}
							menu={onCloseTabs && <TabMenuItems path={path} paths={paths} onCloseTabs={onCloseTabs} />}
							onSelect={() => onSelect(path)}
							onClose={() => onClose(path)}
						/>
					))}
				</SortableContext>
			</DndContext>
		</div>
	);
}

/** The bar tabs sit in, shared by the editor and the Tests drawer so their tabs line up the same way. */
export function TabBar({
	label,
	isBordered = true,
	leading,
	trailing,
	children,
}: {
	label: string;
	isBordered?: boolean;
	leading?: ReactNode;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			className={cn('flex shrink-0 items-center gap-1 px-1.5 text-xs', isBordered && 'border-b')}
			style={{ height: TAB_BAR_HEIGHT }}
		>
			{leading}
			<div role='tablist' aria-label={label} className='flex h-full min-w-0 flex-1 items-center gap-0.5'>
				{children}
			</div>
			{trailing}
		</div>
	);
}

/**
 * A tab like an editor tab. Its leading icon sits in a fixed slot so every tab spaces it the same way; tabs that can
 * close show a cross and also close on a middle click.
 */
export function EditorTab({
	label,
	badge,
	description,
	leading,
	title,
	isActive,
	isUnsaved = false,
	menu,
	onSelect,
	onClose,
	drag,
}: {
	label: string;
	/** A count shown after the label, such as the changes waiting in a view. */
	badge?: number;
	description?: string;
	leading?: ReactNode;
	title?: string;
	isActive: boolean;
	isUnsaved?: boolean;
	menu?: ReactNode;
	onSelect: () => void;
	onClose?: () => void;
	drag?: EditorTabDrag;
}) {
	const tabRef = useRef<HTMLDivElement>(null);
	const setTabRef = useMergedTabRef(tabRef, drag?.nodeRef);

	useEffect(() => {
		if (isActive) {
			tabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		}
	}, [isActive]);

	const tab = (
		<div
			ref={setTabRef}
			style={drag?.style}
			{...drag?.listeners}
			className={cn(
				'group flex h-7 shrink-0 items-center rounded-md transition-colors',
				isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
				drag?.isDragging && 'relative z-10 cursor-grabbing bg-background shadow-md',
			)}
			onAuxClick={(event) => {
				if (event.button === 1 && onClose) {
					event.preventDefault();
					onClose();
				}
			}}
		>
			{leading && (
				<span className='relative ml-2.5 flex size-4 shrink-0 items-center justify-center'>{leading}</span>
			)}
			<button
				type='button'
				role='tab'
				aria-selected={isActive}
				aria-label={description ? `${label}, ${description}` : undefined}
				title={title ?? label}
				onClick={onSelect}
				className={cn(
					'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5',
					leading ? 'pl-1.5' : 'pl-2.5',
					onClose ? 'pr-1.5' : 'pr-2.5',
				)}
			>
				<span className='max-w-60 truncate whitespace-nowrap'>{label}</span>
				{badge !== undefined && (
					<span className='flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums'>
						{badge}
					</span>
				)}
				{description && (
					<span className='max-w-40 truncate whitespace-nowrap text-muted-foreground/70'>{description}</span>
				)}
			</button>
			{onClose && (
				<TabCloseButton title={title ?? label} isActive={isActive} isUnsaved={isUnsaved} onClose={onClose} />
			)}
		</div>
	);

	if (!menu) {
		return tab;
	}
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
			<ContextMenuContent>{menu}</ContextMenuContent>
		</ContextMenu>
	);
}

/** Shows a dot instead of the cross on a tab with unsaved changes, until hovered. */
function TabCloseButton({
	title,
	isActive,
	isUnsaved,
	onClose,
}: {
	title: string;
	isActive: boolean;
	isUnsaved: boolean;
	onClose: () => void;
}) {
	return (
		<button
			type='button'
			aria-label={`Close ${title}`}
			onClick={onClose}
			className={cn(
				'mr-2 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100',
				isActive || isUnsaved ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
			)}
		>
			{isUnsaved && <span className='size-2 rounded-full bg-foreground/70 group-hover:hidden' />}
			<X className={cn('size-3', isUnsaved && 'hidden group-hover:block')} />
		</button>
	);
}

function TabMenuItems({
	path,
	paths,
	onCloseTabs,
}: {
	path: string;
	paths: string[];
	onCloseTabs: (paths: string[]) => void;
}) {
	const index = paths.indexOf(path);

	return (
		<>
			<ContextMenuItem onSelect={() => onCloseTabs([path])}>Close</ContextMenuItem>
			<ContextMenuItem
				disabled={paths.length === 1}
				onSelect={() => onCloseTabs(paths.filter((openedPath) => openedPath !== path))}
			>
				Close others
			</ContextMenuItem>
			<ContextMenuItem disabled={index === paths.length - 1} onSelect={() => onCloseTabs(paths.slice(index + 1))}>
				Close to the right
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => onCloseTabs(paths)}>Close all</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem onSelect={() => void navigator.clipboard.writeText(path)}>Copy path</ContextMenuItem>
		</>
	);
}

function SortableTab({
	path,
	label,
	description,
	isActive,
	isUnsaved,
	renderIcon,
	menu,
	onSelect,
	onClose,
}: {
	path: string;
	label: string;
	description?: string;
	isActive: boolean;
	isUnsaved: boolean;
	renderIcon: (icon: ReactNode) => ReactNode;
	menu?: ReactNode;
	onSelect: () => void;
	onClose: () => void;
}) {
	const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: path });

	return (
		<EditorTab
			label={label}
			description={description}
			title={path}
			leading={renderIcon(
				<FileExplorerIcon name={getTabFileName(path)} type='file' path={path} className='size-3.5' />,
			)}
			isActive={isActive}
			isUnsaved={isUnsaved}
			menu={menu}
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
	nodeRef: EditorTabDrag['nodeRef'] | undefined,
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

function getTabFileName(path: string): string {
	return getFileName(path) ?? path;
}
