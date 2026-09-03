import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';

interface EditableOrganizationNameProps {
	name: string;
	canEdit: boolean;
}

export function EditableOrganizationName({ name, canEdit }: EditableOrganizationNameProps) {
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState(name);
	const rename = useMutation(
		trpc.organization.rename.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.organization.get.queryKey() }),
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
			rename.mutate({ name: nextName });
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
				aria-label='Organization name'
				onChange={(event) => setDraft(event.target.value)}
				onBlur={submit}
				onKeyDown={handleKeyDown}
				disabled={rename.isPending}
				className='w-fit min-w-48 text-lg font-semibold md:text-lg'
			/>
		);
	}

	return (
		<div className='flex items-center gap-2'>
			<h1 className='text-lg font-semibold text-foreground'>{name}</h1>
			{canEdit && (
				<Button
					variant='ghost'
					size='icon-sm'
					aria-label='Rename organization'
					onClick={startEditing}
					disabled={rename.isPending}
				>
					<Pencil className='size-4' />
				</Button>
			)}
			{rename.isError && <span className='text-sm text-destructive'>{rename.error.message}</span>}
		</div>
	);
}
