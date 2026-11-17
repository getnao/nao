/* @license Enterprise */

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import {
	DEFAULT_STORIES_PAGE_FILTERS,
	MAX_MENU_ENTRY_LABEL_LENGTH,
	sidebarMenuEntrySchema,
} from '@nao/shared/sidebar-menu';
import type { CustomMenuEntry, StoriesPageFilters } from '@nao/shared/sidebar-menu';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

type CustomEntryType = CustomMenuEntry['type'];

interface EntryDraft {
	label: string;
	type: CustomEntryType;
	storyId: string;
	filters: StoriesPageFilters;
	url: string;
}

const ENTRY_TYPE_OPTIONS: { value: CustomEntryType; label: string; description: string }[] = [
	{ value: 'stories-page', label: 'Stories page', description: 'The Stories page with filters already applied.' },
	{ value: 'story', label: 'Story', description: 'Opens one story.' },
	{ value: 'link', label: 'Link', description: 'Opens a web page in a new tab.' },
];

const ANY_FOLDER = 'any-folder';

export function SidebarMenuEntryDialog({
	entry,
	open,
	onOpenChange,
	onSave,
}: {
	entry: CustomMenuEntry | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (entry: CustomMenuEntry) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle>{entry ? 'Edit menu entry' : 'Add menu entry'}</DialogTitle>
					<DialogDescription>Entries show in the sidebar for everyone in this project.</DialogDescription>
				</DialogHeader>
				{open && (
					<EntryForm
						key={entry?.id ?? 'new'}
						entry={entry}
						onCancel={() => onOpenChange(false)}
						onSave={onSave}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function EntryForm({
	entry,
	onCancel,
	onSave,
}: {
	entry: CustomMenuEntry | null;
	onCancel: () => void;
	onSave: (entry: CustomMenuEntry) => void;
}) {
	const [draft, setDraft] = useState<EntryDraft>(() => toDraft(entry));
	const [error, setError] = useState<string | null>(null);
	const labelId = useId();
	const typeDescription = ENTRY_TYPE_OPTIONS.find((option) => option.value === draft.type)?.description;

	function updateDraft(patch: Partial<EntryDraft>) {
		setDraft((current) => ({ ...current, ...patch }));
		setError(null);
	}

	function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		const parsed = sidebarMenuEntrySchema.safeParse(
			toEntry(draft, entry?.id ?? crypto.randomUUID(), entry?.icon ?? null),
		);
		if (!parsed.success || parsed.data.type === 'built-in') {
			setError(getDraftError(draft));
			return;
		}
		onSave(parsed.data);
	}

	return (
		<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
			<Field label='Name' htmlFor={labelId}>
				<Input
					id={labelId}
					value={draft.label}
					maxLength={MAX_MENU_ENTRY_LABEL_LENGTH}
					placeholder='Apps'
					onChange={(event) => updateDraft({ label: event.target.value })}
				/>
			</Field>
			<Field label='Opens' hint={typeDescription}>
				<Select value={draft.type} onValueChange={(type) => updateDraft({ type: type as CustomEntryType })}>
					<SelectTrigger className='w-full'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{ENTRY_TYPE_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>
			{draft.type === 'story' && (
				<StoryPicker storyId={draft.storyId} onChange={(storyId) => updateDraft({ storyId })} />
			)}
			{draft.type === 'stories-page' && (
				<StoriesFiltersFields filters={draft.filters} onChange={(filters) => updateDraft({ filters })} />
			)}
			{draft.type === 'link' && <LinkField url={draft.url} onChange={(url) => updateDraft({ url })} />}
			{error && <p className='text-sm text-destructive'>{error}</p>}
			<DialogFooter>
				<Button type='button' variant='ghost' onClick={onCancel}>
					Cancel
				</Button>
				<Button type='submit'>{entry ? 'Save entry' : 'Add entry'}</Button>
			</DialogFooter>
		</form>
	);
}

function StoryPicker({ storyId, onChange }: { storyId: string; onChange: (storyId: string) => void }) {
	const stories = useQuery(trpc.story.listReferenceable.queryOptions());

	return (
		<Field label='Story'>
			<Select value={storyId || undefined} onValueChange={onChange} disabled={stories.isLoading}>
				<SelectTrigger className='w-full'>
					<SelectValue placeholder={stories.isLoading ? 'Loading stories…' : 'Pick a story'} />
				</SelectTrigger>
				<SelectContent>
					{(stories.data ?? []).map((story) => (
						<SelectItem key={story.storyId} value={story.storyId}>
							{story.title}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	);
}

function StoriesFiltersFields({
	filters,
	onChange,
}: {
	filters: StoriesPageFilters;
	onChange: (filters: StoriesPageFilters) => void;
}) {
	const folders = useSharedFolderOptions();

	function update(patch: Partial<StoriesPageFilters>) {
		onChange({ ...filters, ...patch });
	}

	return (
		<div className='flex flex-col gap-4 rounded-lg border p-4'>
			<Field label='Format'>
				<Select
					value={filters.format}
					onValueChange={(format) => update({ format: format as StoriesPageFilters['format'] })}
				>
					<SelectTrigger className='w-full'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='any'>Any format</SelectItem>
						<SelectItem value='classic'>Classic stories</SelectItem>
						<SelectItem value='custom'>Custom stories (apps)</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			<Field label='Owner'>
				<Select
					value={filters.owner}
					onValueChange={(owner) => update({ owner: owner as StoriesPageFilters['owner'] })}
				>
					<SelectTrigger className='w-full'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='anyone'>Anyone</SelectItem>
						<SelectItem value='me'>The person viewing</SelectItem>
						<SelectItem value='others'>Other people</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			<Field label='Start in folder'>
				<Select
					value={filters.folderId ?? ANY_FOLDER}
					onValueChange={(folderId) => update({ folderId: folderId === ANY_FOLDER ? null : folderId })}
				>
					<SelectTrigger className='w-full'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ANY_FOLDER}>All stories</SelectItem>
						{folders.map((folder) => (
							<SelectItem key={folder.id} value={folder.id}>
								{folder.path}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>
			<ToggleRow
				label='Certified only'
				checked={filters.certifiedOnly}
				onChange={(certifiedOnly) => update({ certifiedOnly })}
			/>
			<ToggleRow label='Live only' checked={filters.liveOnly} onChange={(liveOnly) => update({ liveOnly })} />
		</div>
	);
}

function LinkField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
	const urlId = useId();

	return (
		<Field label='URL' htmlFor={urlId}>
			<Input
				id={urlId}
				type='url'
				value={url}
				placeholder='https://intranet.example.com'
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}

function Field({
	label,
	htmlFor,
	hint,
	children,
}: {
	label: string;
	htmlFor?: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className='flex flex-col gap-1.5'>
			<label htmlFor={htmlFor} className='text-sm font-medium'>
				{label}
			</label>
			{children}
			{hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
		</div>
	);
}

function ToggleRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className='flex items-center justify-between gap-4'>
			<span className='text-sm'>{label}</span>
			<Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
		</div>
	);
}

/** Only shared folders, since everyone in the project sees the entry. */
export function useSharedFolderOptions(): { id: string; path: string }[] {
	const tree = useQuery(trpc.storyFolder.listTree.queryOptions({ archived: false }));
	const folders = tree.data ?? [];
	const byId = new Map(folders.map((folder) => [folder.id, folder]));

	return folders
		.filter((folder) => folder.visibility === 'public' && !folder.systemType)
		.map((folder) => ({ id: folder.id, path: buildFolderPath(folder.id, byId) }))
		.sort((a, b) => a.path.localeCompare(b.path));
}

function buildFolderPath(folderId: string, byId: Map<string, { name: string; parentId: string | null }>): string {
	const names: string[] = [];
	let current = byId.get(folderId);
	while (current) {
		names.unshift(current.name);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return names.join(' / ');
}

function toDraft(entry: CustomMenuEntry | null): EntryDraft {
	return {
		label: entry?.label ?? '',
		type: entry?.type ?? 'stories-page',
		storyId: entry?.type === 'story' ? entry.storyId : '',
		filters: entry?.type === 'stories-page' ? entry.filters : DEFAULT_STORIES_PAGE_FILTERS,
		url: entry?.type === 'link' ? entry.url : '',
	};
}

function toEntry(draft: EntryDraft, id: string, icon: string | null): CustomMenuEntry {
	const label = draft.label.trim();
	switch (draft.type) {
		case 'story':
			return { type: 'story', id, label, icon, storyId: draft.storyId };
		case 'stories-page':
			return { type: 'stories-page', id, label, icon, filters: draft.filters };
		case 'link':
			return { type: 'link', id, label, icon, url: draft.url.trim() };
	}
}

function getDraftError(draft: EntryDraft): string {
	if (!draft.label.trim()) {
		return 'Give the entry a name.';
	}
	if (draft.type === 'story' && !draft.storyId) {
		return 'Pick a story.';
	}
	if (draft.type === 'link') {
		return 'Enter a full http:// or https:// address.';
	}
	return 'This entry is not valid.';
}
