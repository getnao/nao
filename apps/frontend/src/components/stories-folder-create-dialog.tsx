import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Folder } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc } from '@/main';

type Mode = 'create' | 'modify';

export function FolderCreateDialog({
	open,
	onOpenChange,
	mode,
	initialName,
	folderId,
	parentId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: Mode;
	initialName?: string;
	folderId?: string;
	parentId?: string | null;
}) {
	const [name, setName] = useState(initialName ?? '');
	const inputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (open) {
			setName(initialName ?? '');
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [open, initialName]);

	const createMutation = useMutation(
		trpc.storyFolder.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				onOpenChange(false);
			},
		}),
	);

	const renameMutation = useMutation(
		trpc.storyFolder.rename.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				onOpenChange(false);
			},
		}),
	);

	const isPending = createMutation.isPending || renameMutation.isPending;
	const trimmed = name.trim();

	function handleSubmit() {
		if (!trimmed) {
			return;
		}
		if (mode === 'create') {
			createMutation.mutate({ name: trimmed, parentId: parentId ?? null });
		} else if (folderId) {
			renameMutation.mutate({ id: folderId, name: trimmed });
		}
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Enter') {
			handleSubmit();
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-sm'>
				<DialogHeader>
					<DialogTitle>{mode === 'create' ? 'New folder' : 'Rename folder'}</DialogTitle>
				</DialogHeader>
				<div className='flex items-center gap-2.5 rounded-md border bg-background px-3 py-2'>
					<Folder className='size-4 shrink-0 text-muted-foreground' />
					<input
						ref={inputRef}
						type='text'
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder='Folder name'
						maxLength={100}
						className='flex-1 bg-transparent text-sm outline-none'
					/>
				</div>
				<DialogFooter>
					<Button variant='ghost' onClick={() => onOpenChange(false)} disabled={isPending}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={!trimmed || isPending}>
						{mode === 'create' ? 'Create' : 'Save'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
