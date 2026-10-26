import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck, FlaskConical } from 'lucide-react';

import type { TestDraft } from '@/lib/test-draft';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { FormActions, TextareaField, TextField } from '@/components/ui/form-fields';
import { trpc } from '@/main';

interface SaveAsTestDialogProps {
	draft: TestDraft;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SaveAsTestDialog({ draft, open, onOpenChange }: SaveAsTestDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton className='sm:max-w-2xl'>
				<DialogHeader>
					<DialogTitle className='flex items-center gap-2'>
						<FlaskConical className='size-4' />
						Save as test
					</DialogTitle>
					<DialogDescription>
						The test asks the question again and checks the agent gets the same data as the reference SQL.
						It is created as a change of your context, to commit or review like any other.
					</DialogDescription>
				</DialogHeader>
				{open && <SaveAsTestForm draft={draft} onClose={() => onOpenChange(false)} />}
			</DialogContent>
		</Dialog>
	);
}

function SaveAsTestForm({ draft, onClose }: { draft: TestDraft; onClose: () => void }) {
	const createTestFile = useMutation(trpc.testRun.createTestFile.mutationOptions());
	const form = useForm({
		defaultValues: { name: draft.name, prompt: draft.prompt, sql: draft.sql, tags: '' },
		onSubmit: async ({ value }) => {
			await createTestFile.mutateAsync({
				name: value.name,
				prompt: value.prompt,
				sql: value.sql.trim() || undefined,
				databaseId: draft.databaseId ?? undefined,
				tags: parseTags(value.tags),
			});
		},
	});

	if (createTestFile.data) {
		return <SavedTest path={createTestFile.data.path} onClose={onClose} />;
	}

	return (
		<form
			className='flex flex-col gap-4'
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<TextField form={form} name='name' label='Name' required />
			<TextareaField form={form} name='prompt' label='Question' rows={3} required />
			<TextareaField form={form} name='sql' label='Reference SQL' hint='(expected data)' rows={8} />
			<TextField form={form} name='tags' label='Tags' hint='(comma-separated)' placeholder='finance, weekly' />
			{createTestFile.error && <ErrorMessage message={createTestFile.error.message} />}
			<FormActions form={form} submitText='Save test' onCancel={onClose} isPending={createTestFile.isPending} />
		</form>
	);
}

function SavedTest({ path, onClose }: { path: string; onClose: () => void }) {
	return (
		<div className='flex flex-col gap-4'>
			<p className='flex items-center gap-2 text-sm'>
				<CircleCheck className='size-4 text-emerald-600 dark:text-emerald-400' />
				Test saved to <span className='font-mono'>{path}</span>
			</p>
			<p className='text-sm text-muted-foreground'>
				Run it from the file, then commit it to add it to the production tests.
			</p>
			<div className='flex justify-end gap-2'>
				<Button variant='ghost' size='sm' onClick={onClose}>
					Close
				</Button>
				<Button size='sm' asChild>
					<Link to='/settings/context-explorer' search={{ path }}>
						Open test
					</Link>
				</Button>
			</div>
		</div>
	);
}

function parseTags(tags: string): string[] {
	return [
		...new Set(
			tags
				.split(',')
				.map((tag) => tag.trim())
				.filter(Boolean),
		),
	];
}
