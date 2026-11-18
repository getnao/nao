import {
	isReservedSandboxSecretName,
	SANDBOX_SECRET_DESCRIPTION_MAX_LENGTH,
	SANDBOX_SECRET_NAME_MAX_LENGTH,
	SANDBOX_SECRET_NAME_PATTERN,
	SANDBOX_SECRET_VALUE_MAX_LENGTH,
	SANDBOX_SECRET_VALUE_MIN_LENGTH,
} from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';
import { useSandboxSecretMutations, useSandboxSecretsQuery } from '@/queries/use-sandbox-secrets';

type SandboxSecret = NonNullable<ReturnType<typeof useSandboxSecretsQuery>['data']>[number];

type DialogState = { mode: 'create' } | { mode: 'edit'; secret: SandboxSecret } | null;

export function SettingsSandboxSecrets() {
	const secrets = useSandboxSecretsQuery();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const { setMutation, updateDescriptionMutation, deleteMutation } = useSandboxSecretMutations();
	const [dialog, setDialog] = useState<DialogState>(null);
	const [secretToDelete, setSecretToDelete] = useState<SandboxSecret | null>(null);

	const sandboxesDisabled = agentSettings.isSuccess && !(agentSettings.data?.experimental?.sandboxes ?? false);

	const openDialog = (state: DialogState) => {
		setMutation.reset();
		updateDescriptionMutation.reset();
		setDialog(state);
	};

	const closeDialog = () => {
		setDialog(null);
		setMutation.reset();
		updateDescriptionMutation.reset();
	};

	const openDeleteDialog = (secret: SandboxSecret) => {
		deleteMutation.reset();
		setSecretToDelete(secret);
	};

	const handleConfirmDelete = () => {
		if (!secretToDelete) {
			return;
		}
		deleteMutation.mutate({ secretId: secretToDelete.id }, { onSuccess: () => setSecretToDelete(null) });
	};

	return (
		<SettingsCard
			title='Sandbox secrets'
			description='API keys and other credentials the code running in a sandbox can read as environment variables. They are yours alone: encrypted, never shown again, and never sent to the model.'
			action={
				<Button size='sm' onClick={() => openDialog({ mode: 'create' })}>
					<Plus />
					Add secret
				</Button>
			}
			divide
		>
			{sandboxesDisabled && (
				<p className='text-xs text-muted-foreground'>
					Sandboxes are off for this project, so these secrets are not used yet. Turn on{' '}
					<span className='font-medium text-foreground'>Sandboxes</span> in Experimental above to let the
					agent run code that reads them.
				</p>
			)}
			{secrets.isLoading ? (
				<div className='flex flex-col divide-y'>
					<SandboxSecretSkeleton className='pt-0' />
					<SandboxSecretSkeleton className='pb-0' />
				</div>
			) : secrets.isError ? (
				<ErrorMessage message={secrets.error.message} />
			) : !secrets.data?.length ? (
				<Empty>No secrets yet. Add one to make it available to the agent's sandboxes.</Empty>
			) : (
				<div className='flex flex-col divide-y'>
					{secrets.data.map((secret) => (
						<SandboxSecretItem
							key={secret.id}
							secret={secret}
							className='first:pt-0 last:pb-0'
							onEdit={() => openDialog({ mode: 'edit', secret })}
							onDelete={() => openDeleteDialog(secret)}
						/>
					))}
				</div>
			)}

			<SandboxSecretDialog
				state={dialog}
				onClose={closeDialog}
				isPending={setMutation.isPending || updateDescriptionMutation.isPending}
				error={setMutation.error?.message ?? updateDescriptionMutation.error?.message}
				onSubmit={async ({ name, value, description }) => {
					if (dialog?.mode === 'edit' && !value) {
						await updateDescriptionMutation.mutateAsync({ secretId: dialog.secret.id, description });
					} else {
						await setMutation.mutateAsync({ name, value, description });
					}
					closeDialog();
				}}
			/>

			<ConfirmationDialog
				open={!!secretToDelete}
				onOpenChange={(open) => !open && setSecretToDelete(null)}
				title='Delete secret?'
				description={`${secretToDelete?.name ?? 'This secret'} will no longer be available in sandboxes. Code that reads it will fail until you add it again.`}
				confirmLabel='Delete'
				onConfirm={handleConfirmDelete}
				isPending={deleteMutation.isPending}
				error={deleteMutation.error?.message}
			/>
		</SettingsCard>
	);
}

function SandboxSecretItem({
	secret,
	onEdit,
	onDelete,
	className,
}: {
	secret: SandboxSecret;
	onEdit: () => void;
	onDelete: () => void;
	className?: string;
}) {
	return (
		<div className={cn('flex items-center gap-4 py-2 group', className)}>
			<div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
				<KeyRound className='size-4' />
			</div>
			<div className='flex-1 min-w-0'>
				<div className='flex items-baseline gap-2 min-w-0'>
					<span className='text-sm font-medium font-mono text-foreground truncate'>{secret.name}</span>
					<span className='text-xs text-muted-foreground shrink-0'>
						Updated {getTimeAgo(new Date(secret.updatedAt).getTime()).humanReadable}
					</span>
				</div>
				{secret.description && <p className='text-xs text-muted-foreground truncate'>{secret.description}</p>}
			</div>
			<div className='flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity'>
				<Button variant='ghost-muted' size='icon-sm' onClick={onEdit} aria-label={`Edit ${secret.name}`}>
					<Pencil />
				</Button>
				<Button variant='ghost-muted' size='icon-sm' onClick={onDelete} aria-label={`Delete ${secret.name}`}>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

function SandboxSecretSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn('flex items-center gap-4 py-2', className)}>
			<Skeleton className='size-8 rounded-md' />
			<div className='flex-1 min-w-0 space-y-2'>
				<Skeleton className='h-3 w-32' />
				<Skeleton className='h-3 w-full max-w-xs' />
			</div>
		</div>
	);
}

interface SandboxSecretFormValues {
	name: string;
	value: string;
	description: string;
}

function SandboxSecretDialog({
	state,
	onClose,
	onSubmit,
	isPending,
	error,
}: {
	state: DialogState;
	onClose: () => void;
	onSubmit: (values: SandboxSecretFormValues) => Promise<void>;
	isPending: boolean;
	error?: string;
}) {
	const isEdit = state?.mode === 'edit';
	const editedSecret = state?.mode === 'edit' ? state.secret : null;

	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className='p-6' showCloseButton={false}>
				{state && (
					<SandboxSecretForm
						key={editedSecret?.id ?? 'create'}
						isEdit={isEdit}
						initialValues={{
							name: editedSecret?.name ?? '',
							value: '',
							description: editedSecret?.description ?? '',
						}}
						onCancel={onClose}
						onSubmit={onSubmit}
						isPending={isPending}
						error={error}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function SandboxSecretForm({
	isEdit,
	initialValues,
	onCancel,
	onSubmit,
	isPending,
	error,
}: {
	isEdit: boolean;
	initialValues: SandboxSecretFormValues;
	onCancel: () => void;
	onSubmit: (values: SandboxSecretFormValues) => Promise<void>;
	isPending: boolean;
	error?: string;
}) {
	const [values, setValues] = useState(initialValues);
	const normalizedName = values.name.trim().toUpperCase();
	const nameError = getNameError(normalizedName);
	const valueError = getValueError(values.value, isEdit);
	const canSubmit = !nameError && !valueError && !isPending;

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!canSubmit) {
			return;
		}
		onSubmit({ ...values, name: normalizedName, description: values.description.trim() }).catch(console.error);
	};

	return (
		<form onSubmit={handleSubmit} className='flex flex-col gap-5'>
			<DialogHeader>
				<DialogTitle>{isEdit ? `Edit ${initialValues.name}` : 'Add secret'}</DialogTitle>
				<DialogDescription>
					{isEdit
						? 'Enter a new value to replace the current one, or leave it empty to only change the description.'
						: 'The secret becomes an environment variable of the same name inside every sandbox the agent runs for you.'}
				</DialogDescription>
			</DialogHeader>

			<div className='flex flex-col gap-4'>
				{!isEdit && (
					<div className='grid gap-1.5'>
						<label htmlFor='sandbox-secret-name' className='text-sm font-medium text-foreground'>
							Name
						</label>
						<Input
							id='sandbox-secret-name'
							autoFocus
							autoComplete='off'
							spellCheck={false}
							maxLength={SANDBOX_SECRET_NAME_MAX_LENGTH}
							placeholder='OPENWEATHER_API_KEY'
							className='font-mono uppercase'
							value={values.name}
							onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
						/>
						<p
							className={cn(
								'text-xs',
								nameError && values.name ? 'text-destructive' : 'text-muted-foreground',
							)}
						>
							{nameError && values.name
								? nameError
								: 'Uppercase letters, digits and underscores, like an environment variable.'}
						</p>
					</div>
				)}

				<div className='grid gap-1.5'>
					<label htmlFor='sandbox-secret-value' className='text-sm font-medium text-foreground'>
						Value
						{isEdit && <span className='text-muted-foreground font-normal ml-1'>(optional)</span>}
					</label>
					<Input
						id='sandbox-secret-value'
						type='password'
						autoFocus={isEdit}
						autoComplete='new-password'
						maxLength={SANDBOX_SECRET_VALUE_MAX_LENGTH}
						placeholder={isEdit ? 'Leave empty to keep the current value' : 'Paste the secret value'}
						className='font-mono'
						value={values.value}
						onChange={(event) => setValues((prev) => ({ ...prev, value: event.target.value }))}
					/>
					{valueError && values.value && <p className='text-xs text-destructive'>{valueError}</p>}
				</div>

				<div className='grid gap-1.5'>
					<label htmlFor='sandbox-secret-description' className='text-sm font-medium text-foreground'>
						Description
						<span className='text-muted-foreground font-normal ml-1'>(optional)</span>
					</label>
					<Input
						id='sandbox-secret-description'
						maxLength={SANDBOX_SECRET_DESCRIPTION_MAX_LENGTH}
						placeholder='API key for the OpenWeather REST API'
						value={values.description}
						onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))}
					/>
					<p className='text-xs text-muted-foreground'>
						Shown to the agent so it knows what the secret is for. Never put the value here.
					</p>
				</div>

				{error && <ErrorMessage message={error} />}
			</div>

			<DialogFooter>
				<Button type='button' variant='ghost' onClick={onCancel} disabled={isPending}>
					Cancel
				</Button>
				<Button type='submit' disabled={!canSubmit} isLoading={isPending}>
					{isEdit ? 'Save' : 'Add secret'}
				</Button>
			</DialogFooter>
		</form>
	);
}

function getNameError(name: string): string | null {
	if (!name) {
		return 'Name is required.';
	}
	if (name.length > SANDBOX_SECRET_NAME_MAX_LENGTH) {
		return `Name must be at most ${SANDBOX_SECRET_NAME_MAX_LENGTH} characters.`;
	}
	if (!SANDBOX_SECRET_NAME_PATTERN.test(name)) {
		return 'Use only uppercase letters, digits and underscores, and do not start with a digit.';
	}
	if (isReservedSandboxSecretName(name)) {
		return 'This name is reserved by the sandbox runtime. Choose another one.';
	}
	return null;
}

function getValueError(value: string, isEdit: boolean): string | null {
	if (value.length === 0) {
		return isEdit ? null : 'Value is required.';
	}
	if (value.length < SANDBOX_SECRET_VALUE_MIN_LENGTH) {
		return `A secret must be at least ${SANDBOX_SECRET_VALUE_MIN_LENGTH} characters.`;
	}
	return null;
}
