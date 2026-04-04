import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderIcon, PencilIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';

import { FolderColorPicker } from '@/components/folder-color-picker';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { trpc } from '@/main';

export function FolderManagementDialog() {
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant='ghost' size='sm' className='text-muted-foreground gap-1.5'>
					<FolderIcon className='size-3.5' />
					<span className='text-xs'>Folders</span>
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Manage Folders</DialogTitle>
					<DialogDescription>Create and organize folders for your stories.</DialogDescription>
				</DialogHeader>
				<FolderManagementContent />
			</DialogContent>
		</Dialog>
	);
}

function FolderManagementContent() {
	const queryClient = useQueryClient();
	const folders = useQuery(trpc.storyFolder.list.queryOptions());
	const [editingId, setEditingId] = useState<string | null>(null);

	const deleteMutation = useMutation(
		trpc.storyFolder.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.list.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	return (
		<div className='space-y-4'>
			<CreateFolderForm />
			{folders.data && folders.data.length > 0 && (
				<div className='space-y-1 max-h-64 overflow-y-auto'>
					{folders.data.map((folder) =>
						editingId === folder.id ? (
							<EditFolderForm key={folder.id} folder={folder} onDone={() => setEditingId(null)} />
						) : (
							<div
								key={folder.id}
								className='flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent group'
							>
								{folder.color && (
									<span
										className='size-2.5 rounded-full shrink-0'
										style={{ backgroundColor: folder.color }}
									/>
								)}
								<span className='text-sm flex-1 truncate'>{folder.name}</span>
								<span className='text-xs text-muted-foreground'>
									{folder.storyCount} {folder.storyCount === 1 ? 'story' : 'stories'}
								</span>
								<Button
									variant='ghost'
									size='icon-xs'
									className='opacity-0 group-hover:opacity-100'
									onClick={() => setEditingId(folder.id)}
								>
									<PencilIcon className='size-3' />
								</Button>
								<Button
									variant='ghost'
									size='icon-xs'
									className='opacity-0 group-hover:opacity-100 text-destructive'
									onClick={() => deleteMutation.mutate({ id: folder.id })}
									disabled={deleteMutation.isPending}
								>
									<TrashIcon className='size-3' />
								</Button>
							</div>
						),
					)}
				</div>
			)}
		</div>
	);
}

function CreateFolderForm() {
	const queryClient = useQueryClient();
	const [name, setName] = useState('');
	const [color, setColor] = useState<string | null>(null);

	const createMutation = useMutation(
		trpc.storyFolder.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.list.queryKey() });
				setName('');
				setColor(null);
			},
		}),
	);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}
		createMutation.mutate({ name: trimmed, color });
	}

	return (
		<form onSubmit={handleSubmit} className='space-y-3'>
			<div className='flex items-center gap-2'>
				<input
					type='text'
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder='New folder name...'
					className='flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring'
					maxLength={100}
				/>
				<Button type='submit' size='sm' disabled={!name.trim() || createMutation.isPending}>
					<PlusIcon className='size-3.5' />
					Add
				</Button>
			</div>
			<FolderColorPicker value={color} onChange={setColor} />
			{createMutation.isError && <p className='text-xs text-destructive'>{createMutation.error.message}</p>}
		</form>
	);
}

function EditFolderForm({
	folder,
	onDone,
}: {
	folder: { id: string; name: string; color: string | null };
	onDone: () => void;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(folder.name);
	const [color, setColor] = useState<string | null>(folder.color);

	const updateMutation = useMutation(
		trpc.storyFolder.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.list.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				onDone();
			},
		}),
	);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}
		updateMutation.mutate({ id: folder.id, name: trimmed, color });
	}

	return (
		<form onSubmit={handleSubmit} className='space-y-2 rounded-md border p-2'>
			<div className='flex items-center gap-2'>
				<input
					type='text'
					value={name}
					onChange={(e) => setName(e.target.value)}
					className='flex-1 rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring'
					maxLength={100}
					autoFocus
				/>
				<Button type='submit' size='sm' variant='ghost' disabled={!name.trim() || updateMutation.isPending}>
					Save
				</Button>
				<Button type='button' size='sm' variant='ghost' onClick={onDone}>
					Cancel
				</Button>
			</div>
			<FolderColorPicker value={color} onChange={setColor} />
			{updateMutation.isError && <p className='text-xs text-destructive'>{updateMutation.error.message}</p>}
		</form>
	);
}
