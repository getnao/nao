import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogCancel,
	AlertDialogAction,
} from './ui/alert-dialog';
import { Dialog, DialogTitle, DialogHeader, DialogContent, DialogFooter } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { NakedInput } from './ui/input';
import { SavedPromptItem, SavedPromptSkeleton } from './settings-saved-prompt';
import { ErrorMessage } from './ui/error-message';
import { SettingsCard } from './ui/settings-card';
import type { SavedPrompt } from '@nao/backend/saved-prompts';
import { useSavedPromptsQuery, useSavedPromptMutations } from '@/hooks/use-saved-prompts';
import { Button } from '@/components/ui/button';

interface SavedPromptsSectionProps {
	isAdmin: boolean;
}

export function SavedPrompts({ isAdmin }: SavedPromptsSectionProps) {
	const [showDialogPrompt, setShowDialogPrompt] = useState(false);
	const [dialogPrompt, setDialogPrompt] = useState<SavedPrompt>(); // Current prompt being edited or created
	const [showDeleteAlert, setShowDeleteAlert] = useState(false);
	const [promptToDelete, setPromptToDelete] = useState<{ id: string; title: string }>();
	const { data: savedPrompts = [], isLoading } = useSavedPromptsQuery();
	const { createMutation, updateMutation, deleteMutation } = useSavedPromptMutations();

	const handleNewPrompt = () => {
		setDialogPrompt({
			id: '',
			title: '',
			prompt: '',
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		setShowDialogPrompt(true);
	};

	const handleSavePrompt = async (data: { title: string; prompt: string }) => {
		if (!dialogPrompt) {
			return;
		}

		updateMutation.reset();
		createMutation.reset();

		if (dialogPrompt.id) {
			// Update existing prompt
			await updateMutation.mutateAsync({
				id: dialogPrompt.id,
				title: data.title,
				prompt: data.prompt,
			});
		} else {
			// Create new prompt
			await createMutation.mutateAsync({
				title: data.title,
				prompt: data.prompt,
			});
		}

		setDialogPrompt(undefined);
	};

	const handleEditPrompt = (id: string) => {
		setDialogPrompt(savedPrompts.find((prompt) => prompt.id === id));
		setShowDialogPrompt(true);
	};

	const handleDeletePrompt = (id: string) => {
		setPromptToDelete({ id, title: savedPrompts.find((prompt) => prompt.id === id)?.title || '' });
		setShowDeleteAlert(true);
	};

	const handleDeleteAlertAction = () => {
		if (promptToDelete) {
			deleteMutation.mutate({ promptId: promptToDelete.id });
		}
	};

	return (
		<>
			<SettingsCard title='Saved Prompts'>
				{isLoading ? (
					<div className='flex flex-col divide-y'>
						<SavedPromptSkeleton className='pt-0' />
						<SavedPromptSkeleton />
						<SavedPromptSkeleton className='pb-0' />
					</div>
				) : savedPrompts.length === 0 ? (
					<div className='text-sm text-muted-foreground py-4 text-center'>
						Save repeatable, customizable prompts for the agent to follow.
					</div>
				) : (
					<div className='flex flex-col divide-y'>
						{savedPrompts.map((prompt) => (
							<SavedPromptItem
								key={prompt.id}
								prompt={prompt}
								className='last:pb-0 first:pt-0'
								onEdit={handleEditPrompt}
								onDelete={handleDeletePrompt}
							/>
						))}
					</div>
				)}

				{isAdmin && (
					<Button variant='outline' size='sm' className='ml-auto' onClick={handleNewPrompt}>
						<Plus className='size-4' />
						New Prompt
					</Button>
				)}
			</SettingsCard>

			{dialogPrompt && (
				<PromptDialog
					open={showDialogPrompt}
					prompt={dialogPrompt}
					onClose={() => setShowDialogPrompt(false)}
					onSave={handleSavePrompt}
					error={createMutation.error?.message || updateMutation.error?.message}
				/>
			)}

			{promptToDelete && (
				<DeletePromptDialog
					open={showDeleteAlert}
					promptToDelete={promptToDelete}
					onOpenChange={setShowDeleteAlert}
					onDelete={handleDeleteAlertAction}
					isLoading={deleteMutation.isPending}
					error={deleteMutation.error?.message}
				/>
			)}
		</>
	);
}

const PromptDialog = ({
	prompt,
	onClose,
	onSave,
	open,
	error,
}: {
	prompt: SavedPrompt;
	onClose: () => void;
	onSave: (data: { title: string; prompt: string }) => Promise<void>;
	open: boolean;
	error?: string;
}) => {
	const form = useForm({
		defaultValues: {
			title: prompt.title,
			prompt: prompt.prompt,
		},
		validators: {
			onChange: ({ value }) => ({
				fields: {
					title: !value.title.trim()
						? 'Title is required'
						: value.title.length < 3
							? 'Title must be at least 3 characters long'
							: undefined,
					prompt: !value.prompt.trim()
						? 'Prompt is required'
						: value.prompt.length < 10
							? 'Prompt must be at least 10 characters long'
							: undefined,
				},
			}),
		},
		onSubmit: async ({ value }) => {
			await onSave(value);
		},
	});

	useEffect(() => {
		form.reset();
	}, [prompt, form]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		form.handleSubmit();
	};

	return (
		<Dialog open={open} onOpenChange={onClose}>
			<DialogContent className='p-6' showCloseButton={false}>
				<form
					onSubmit={handleSubmit}
					className='flex flex-col gap-4'
					onKeyDown={(e) => {
						if (e.key === 'Enter' && e.metaKey) {
							handleSubmit(e);
						}
					}}
				>
					<DialogHeader className='-mb-4 border-b pb-4'>
						<DialogTitle className='text-base font-medium text-foreground w-full'>
							<form.Field name='title'>
								{(field) => (
									<NakedInput
										autoFocus={true}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder='Prompt title (used for UI display)'
										className='w-full '
									/>
								)}
							</form.Field>
						</DialogTitle>
					</DialogHeader>

					<form.Field name='prompt'>
						{(field) => (
							<Textarea
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								placeholder='Describe what the agent should do...'
								className='w-full border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 rounded-none placeholder:font-normal field-sizing-fixed pt-4'
								rows={5}
							/>
						)}
					</form.Field>

					{error && <ErrorMessage message={error} />}

					<form.Subscribe selector={(state) => [state.canSubmit, state.isDefaultValue, state.isSubmitting]}>
						{([canSubmit, isDefaultValue, isSubmitting]) => (
							<DialogFooter>
								<Button
									type='button'
									variant='ghost-muted'
									size='sm'
									onClick={onClose}
									disabled={isSubmitting}
								>
									Cancel
								</Button>

								<Button
									type='submit'
									variant='default'
									size='sm'
									disabled={!canSubmit || isDefaultValue || isSubmitting}
									isLoading={isSubmitting}
								>
									Save
								</Button>
							</DialogFooter>
						)}
					</form.Subscribe>
				</form>
			</DialogContent>
		</Dialog>
	);
};

const DeletePromptDialog = ({
	open,
	promptToDelete,
	onOpenChange,
	onDelete,
	isLoading,
	error,
}: {
	open: boolean;
	promptToDelete: { id: string; title: string };
	onOpenChange: (open: boolean) => void;
	onDelete: () => void;
	isLoading: boolean;
	error?: string;
}) => {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent size='sm' closeOnOutsideClick onCloseOnOutsideClick={() => onOpenChange(false)}>
				<AlertDialogHeader className='p-2'>
					<AlertDialogTitle className='text-md'>Delete "{promptToDelete?.title}"?</AlertDialogTitle>
					<AlertDialogDescription>This will be permanently deleted.</AlertDialogDescription>
					{error && <ErrorMessage message={error} />}
				</AlertDialogHeader>

				<AlertDialogFooter>
					<AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
					<AlertDialogAction variant='destructive' onClick={onDelete} isLoading={isLoading}>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
