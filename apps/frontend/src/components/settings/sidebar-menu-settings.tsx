/* @license Enterprise */

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
	BUILT_IN_MENU_ENTRY_LABELS,
	getMenuEntryLabel,
	countCustomMenuEntries,
	MAX_CUSTOM_MENU_ENTRIES,
	MAX_MENU_ENTRY_LABEL_LENGTH,
} from '@nao/shared/sidebar-menu';
import type { ReactNode } from 'react';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import type { BuiltInMenuEntry, CustomMenuEntry, SidebarMenuEntry, StoriesPageFilters } from '@nao/shared/sidebar-menu';

import type { SidebarMenuAccess } from '@/components/sidebar-menu-nav';
import { IconPicker } from '@/components/settings/icon-picker';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { SidebarMenuEntryDialog, useSharedFolderOptions } from '@/components/settings/sidebar-menu-entry-dialog';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { BUILT_IN_MENU_ICONS, CUSTOM_MENU_ICONS, SidebarMenuList } from '@/components/sidebar-menu-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { useSidebarMenu } from '@/hooks/use-sidebar-menu';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const DRAG_ACTIVATION_DISTANCE = 4;

type DialogState = { entry: CustomMenuEntry | null } | null;

export function SidebarMenuSettings({ isAdmin }: { isAdmin: boolean }) {
	const queryClient = useQueryClient();
	const menu = useSidebarMenu();
	const [draft, setDraft] = useState<SidebarMenuEntry[] | null>(null);
	const [dialog, setDialog] = useState<DialogState>(null);
	const entries = draft ?? menu.entries;
	const isReadOnly = !menu.isCustomizable || !isAdmin;

	const saveMenu = useMutation(trpc.sidebarMenu.update.mutationOptions());
	const resetMenu = useMutation(trpc.sidebarMenu.reset.mutationOptions());
	const error = saveMenu.error ?? resetMenu.error;

	/** Keeps the edits made while the request was running, which the saved menu does not include. */
	async function refreshMenu(submittedDraft: SidebarMenuEntry[] | null) {
		await queryClient.invalidateQueries({ queryKey: trpc.sidebarMenu.get.queryKey() });
		setDraft((current) => (current === submittedDraft ? null : current));
	}

	function updateEntries(update: (current: SidebarMenuEntry[]) => SidebarMenuEntry[]) {
		setDraft(update(entries));
	}

	function handleSaveEntry(entry: CustomMenuEntry) {
		updateEntries((current) =>
			current.some((candidate) => candidate.id === entry.id)
				? current.map((candidate) => (candidate.id === entry.id ? entry : candidate))
				: [...current, entry],
		);
		setDialog(null);
	}

	return (
		<SettingsCard
			title='Sidebar menu'
			description='Rename, hide and reorder the menu entries, or add your own: a story, a filtered Stories page or a link.'
			action={!menu.isCustomizable ? <UpgradeToEnterprise /> : undefined}
		>
			<div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]'>
				<LockedFieldset disabled={isReadOnly}>
					<SortableMenuEntries
						entries={entries}
						onMove={(id, targetId) => updateEntries((current) => moveEntry(current, id, targetId))}
						renderEntry={(entry) => (
							<MenuEntryRow
								key={entry.id}
								entry={entry}
								onChange={(next) => updateEntries((current) => replaceEntry(current, next))}
								onEdit={(custom) => setDialog({ entry: custom })}
								onDelete={() => updateEntries((current) => current.filter(({ id }) => id !== entry.id))}
							/>
						)}
					/>
					<div className='flex flex-wrap items-center justify-between gap-2'>
						<Button
							variant='outline'
							size='sm'
							onClick={() => setDialog({ entry: null })}
							disabled={countCustomMenuEntries(entries) >= MAX_CUSTOM_MENU_ENTRIES}
						>
							<Plus />
							Add entry
						</Button>
						<div className='flex items-center gap-2'>
							<Button
								variant='ghost'
								size='sm'
								onClick={() => resetMenu.mutate(undefined, { onSuccess: () => refreshMenu(draft) })}
								disabled={resetMenu.isPending || saveMenu.isPending}
							>
								Reset to default
							</Button>
							{draft && (
								<Button variant='ghost' size='sm' onClick={() => setDraft(null)}>
									Discard changes
								</Button>
							)}
							<Button
								size='sm'
								onClick={() => saveMenu.mutate({ entries }, { onSuccess: () => refreshMenu(draft) })}
								disabled={!draft || saveMenu.isPending}
							>
								Save menu
							</Button>
						</div>
					</div>
					{error && <p className='text-sm text-destructive'>{error.message}</p>}
				</LockedFieldset>
				<SidebarMenuPreview entries={entries} />
			</div>
			<SidebarMenuEntryDialog
				entry={dialog?.entry ?? null}
				open={dialog !== null}
				onOpenChange={(open) => !open && setDialog(null)}
				onSave={handleSaveEntry}
			/>
		</SettingsCard>
	);
}

function SortableMenuEntries({
	entries,
	onMove,
	renderEntry,
}: {
	entries: SidebarMenuEntry[];
	onMove: (id: string, targetId: string) => void;
	renderEntry: (entry: SidebarMenuEntry) => ReactNode;
}) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const handleDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			onMove(String(active.id), String(over.id));
		}
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[lockToVerticalAxis]}
			onDragEnd={handleDragEnd}
		>
			<SortableContext items={entries.map(({ id }) => id)} strategy={verticalListSortingStrategy}>
				<ul className='flex flex-col divide-y rounded-lg border'>{entries.map(renderEntry)}</ul>
			</SortableContext>
		</DndContext>
	);
}

function SidebarMenuPreview({ entries }: { entries: SidebarMenuEntry[] }) {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const access: SidebarMenuAccess = {
		canCreateChat: true,
		canSeeAutomations: config.data?.betaAutomationsEnabled === true,
		hasInboxActivity: false,
	};

	return (
		<div className='flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start'>
			<span className='text-xs font-medium text-muted-foreground'>Preview</span>
			<div
				inert
				className='w-72 max-w-full rounded-lg border border-sidebar-border bg-sidebar px-2 dark:bg-background'
			>
				<SidebarMenuList entries={entries} access={access} isCollapsed={false} />
			</div>
			<p className='text-xs text-muted-foreground'>Automations only show to people allowed to use them.</p>
		</div>
	);
}

function MenuEntryRow({
	entry,
	onChange,
	onEdit,
	onDelete,
}: {
	entry: SidebarMenuEntry;
	onChange: (entry: SidebarMenuEntry) => void;
	onEdit: (entry: CustomMenuEntry) => void;
	onDelete: () => void;
}) {
	const defaultIcon = entry.type === 'built-in' ? BUILT_IN_MENU_ICONS[entry.id] : CUSTOM_MENU_ICONS[entry.type];
	const label = getMenuEntryLabel(entry);
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: entry.id,
	});

	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				'flex items-center gap-3 bg-background py-2 pr-3 pl-1.5 first:rounded-t-lg last:rounded-b-lg',
				isDragging && 'relative z-10 rounded-lg shadow-md',
			)}
		>
			<button
				ref={setActivatorNodeRef}
				type='button'
				aria-label={`Reorder ${label}`}
				className='flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground active:cursor-grabbing'
				{...attributes}
				{...listeners}
			>
				<GripVertical className='size-4' />
			</button>
			<IconPicker
				value={entry.icon}
				defaultIcon={defaultIcon}
				label={label}
				onChange={(icon) => onChange({ ...entry, icon })}
			/>
			{entry.type === 'built-in' ? (
				<BuiltInEntryFields entry={entry} onChange={onChange} />
			) : (
				<CustomEntryFields entry={entry} onEdit={() => onEdit(entry)} onDelete={onDelete} />
			)}
		</li>
	);
}

function BuiltInEntryFields({
	entry,
	onChange,
}: {
	entry: BuiltInMenuEntry;
	onChange: (entry: SidebarMenuEntry) => void;
}) {
	const defaultLabel = BUILT_IN_MENU_ENTRY_LABELS[entry.id];

	return (
		<>
			<Input
				value={entry.label ?? ''}
				placeholder={defaultLabel}
				maxLength={MAX_MENU_ENTRY_LABEL_LENGTH}
				aria-label={`Name for ${defaultLabel}`}
				className='h-8 min-w-0 flex-1'
				onChange={(event) =>
					onChange({ ...entry, label: event.target.value.trim() ? event.target.value : null })
				}
			/>
			<Switch
				checked={!entry.hidden}
				onCheckedChange={(visible) => onChange({ ...entry, hidden: !visible })}
				aria-label={`Show ${defaultLabel}`}
			/>
		</>
	);
}

function CustomEntryFields({
	entry,
	onEdit,
	onDelete,
}: {
	entry: CustomMenuEntry;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<>
			<div className='flex min-w-0 flex-1 flex-col'>
				<span className='truncate text-sm font-medium'>{entry.label}</span>
				<span className='truncate text-xs text-muted-foreground'>
					<CustomEntryTarget entry={entry} />
				</span>
			</div>
			<Button variant='ghost' size='icon-sm' aria-label={`Edit ${entry.label}`} onClick={onEdit}>
				<Pencil />
			</Button>
			<Button variant='ghost' size='icon-sm' aria-label={`Delete ${entry.label}`} onClick={onDelete}>
				<Trash2 />
			</Button>
		</>
	);
}

function CustomEntryTarget({ entry }: { entry: CustomMenuEntry }) {
	switch (entry.type) {
		case 'story':
			return <StoryTarget storyId={entry.storyId} />;
		case 'stories-page':
			return <StoriesPageTarget filters={entry.filters} />;
		case 'link':
			return <>Link · {entry.url}</>;
	}
}

function StoryTarget({ storyId }: { storyId: string }) {
	const stories = useQuery(trpc.story.listReferenceable.queryOptions());
	const title = stories.data?.find((story) => story.storyId === storyId)?.title;
	return <>Story · {title ?? 'Story not available to you'}</>;
}

function StoriesPageTarget({ filters }: { filters: StoriesPageFilters }) {
	const folders = useSharedFolderOptions();
	const folderPath = folders.find((folder) => folder.id === filters.folderId)?.path ?? null;
	return <>Stories · {describeStoriesFilters(filters, folderPath)}</>;
}

function describeStoriesFilters(filters: StoriesPageFilters, folderPath: string | null): string {
	const parts = [
		filters.format === 'custom' && 'custom format',
		filters.format === 'classic' && 'classic format',
		filters.certifiedOnly && 'certified',
		filters.liveOnly && 'live',
		filters.owner === 'me' && 'owned by the viewer',
		filters.owner === 'others' && 'owned by others',
		folderPath && `in ${folderPath}`,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(', ') : 'no filters';
}

function replaceEntry(entries: SidebarMenuEntry[], next: SidebarMenuEntry): SidebarMenuEntry[] {
	return entries.map((entry) => (entry.id === next.id ? next : entry));
}

function moveEntry(entries: SidebarMenuEntry[], id: string, targetId: string): SidebarMenuEntry[] {
	const fromIndex = entries.findIndex((entry) => entry.id === id);
	const toIndex = entries.findIndex((entry) => entry.id === targetId);
	if (fromIndex === -1 || toIndex === -1) {
		return entries;
	}
	return arrayMove(entries, fromIndex, toIndex);
}

const lockToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
