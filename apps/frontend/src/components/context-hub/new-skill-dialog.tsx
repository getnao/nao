import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/main';

interface NewSkillDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (path: string) => void;
}

export function NewSkillDialog({ open, onOpenChange, onCreated }: NewSkillDialogProps) {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const createSkill = useMutation(trpc.contextExplorer.createSkill.mutationOptions());
	const skillName = toSkillName(title);

	const close = () => {
		setTitle('');
		setDescription('');
		createSkill.reset();
		onOpenChange(false);
	};

	/** The skill opens once it is created, so the dialog stays until then rather than letting Cancel race it. */
	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen) {
			onOpenChange(true);
		} else if (!createSkill.isPending) {
			close();
		}
	};

	const handleCreate = async () => {
		const created = await createSkill.mutateAsync({ name: skillName, description: description.trim() });
		close();
		onCreated(created.path);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<form
					className='flex flex-col gap-4'
					onSubmit={(event) => {
						event.preventDefault();
						void handleCreate().catch(() => undefined);
					}}
				>
					<DialogHeader>
						<DialogTitle>New skill</DialogTitle>
						<DialogDescription>
							A skill teaches the agent how to handle one kind of request. It stays in your changes until
							you publish them.
						</DialogDescription>
					</DialogHeader>
					<label className='flex flex-col gap-1.5 text-sm'>
						Name
						<Input
							autoFocus
							value={title}
							placeholder='Weekly sales report'
							onChange={(event) => setTitle(event.target.value)}
						/>
						{skillName && (
							<span className='text-xs text-muted-foreground'>Saved as agent/skills/{skillName}.md</span>
						)}
					</label>
					<label className='flex flex-col gap-1.5 text-sm'>
						When should the agent use it?
						<Textarea
							value={description}
							placeholder='When someone asks for the weekly sales numbers by region.'
							onChange={(event) => setDescription(event.target.value)}
						/>
					</label>
					{createSkill.error && <ErrorMessage message={createSkill.error.message} />}
					<DialogFooter>
						<Button
							type='button'
							variant='outline'
							disabled={createSkill.isPending}
							onClick={() => handleOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type='submit' disabled={!skillName} isLoading={createSkill.isPending}>
							Create skill
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function toSkillName(title: string): string {
	return title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)
		.replace(/-+$/, '');
}
