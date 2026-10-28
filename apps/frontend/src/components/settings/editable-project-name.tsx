import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';

interface EditableProjectNameProps {
	projectId: string;
	name: string;
	canEdit: boolean;
}

export function EditableProjectName({ projectId, name, canEdit }: EditableProjectNameProps) {
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState(name);
	const rename = useMutation(
		trpc.project.rename.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.project.listForCurrentUser.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.organization.getProjects.queryKey() }),
				]);
			},
		}),
	);

	useEffect(() => {
		if (isEditing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [isEditing]);

	const startEditing = () => {
		setDraft(name);
		setIsEditing(true);
	};

	const submit = () => {
		const nextName = draft.trim();
		setIsEditing(false);
		if (nextName && nextName !== name) {
			rename.mutate({ projectId, name: nextName });
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			submit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			setIsEditing(false);
		}
	};

	if (isEditing) {
		return (
			<Input
				ref={inputRef}
				value={draft}
				maxLength={100}
				aria-label='Project name'
				onChange={(event) => setDraft(event.target.value)}
				onBlur={submit}
				onKeyDown={handleKeyDown}
				disabled={rename.isPending}
				className='h-8 w-64 max-w-full text-right'
			/>
		);
	}

	return (
		<div className='flex flex-col items-end gap-1'>
			<div className='flex items-center gap-1'>
				<span>{rename.isPending ? rename.variables.name : name}</span>
				{canEdit && (
					<Button
						variant='ghost'
						size='icon-sm'
						aria-label='Rename project'
						onClick={startEditing}
						disabled={rename.isPending}
					>
						<Pencil className='size-3.5' />
					</Button>
				)}
			</div>
			{rename.isError && <span className='text-xs text-destructive'>{rename.error.message}</span>}
		</div>
	);
}
