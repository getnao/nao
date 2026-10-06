import { useMutation, useQuery } from '@tanstack/react-query';
import { Database, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { buildWarehouseCredentials } from './warehouse-credentials';
import { WarehouseCredentialsForm } from './warehouse-credentials-form';
import { isSqlProvider, WAREHOUSE_PROVIDER_LABELS } from './warehouse-provider-config';
import type { ToolCallComponentProps } from '.';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-fields';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { getMessageText, NEW_CHAT_ID, ONBOARDING_CONTEXT_REQUEST_PREFIX } from '@/lib/ai';
import { trpc } from '@/main';

export { WarehouseCredentialsForm as SqlCredentialsForm } from './warehouse-credentials-form';

export function RequestWarehouseCredentialsToolCall({
	toolPart,
}: ToolCallComponentProps<'request_warehouse_credentials'>) {
	const provider = toolPart.input?.provider;
	const [open, setOpen] = useState(false);
	const [jobId, setJobId] = useState<string | null>(null);
	const [dialogCenter, setDialogCenter] = useState<number>();
	const cardRef = useRef<HTMLDivElement>(null);
	const notifiedJobId = useRef<string | null>(null);
	const restoredJobId = useRef(false);
	const { chatId, isRunning, queueOrSendMessage } = useAgentContext();
	const canRestoreJob = Boolean(chatId && chatId !== NEW_CHAT_ID);
	const activeJob = useQuery({
		...trpc.onboarding.getActiveWarehouseProvisioningJob.queryOptions({
			onboardingChatId: canRestoreJob ? chatId! : '',
		}),
		enabled: canRestoreJob,
	});
	const job = useWarehouseProvisioningJob(jobId);
	const hasRequestedContext = useAgentMessagesSelector((messages) =>
		jobId
			? messages.some(
					(message) =>
						message.role === 'user' &&
						getMessageText(message).startsWith(`${ONBOARDING_CONTEXT_REQUEST_PREFIX} jobId=${jobId}`),
				)
			: false,
	);
	const startProvisioning = useMutation(
		trpc.onboarding.startWarehouseProvisioning.mutationOptions({
			onSuccess: ({ jobId: nextJobId }) => setJobId(nextJobId),
		}),
	);

	useEffect(() => {
		if (restoredJobId.current || !activeJob.data) {
			return;
		}
		restoredJobId.current = true;
		setJobId(activeJob.data.id);
	}, [activeJob.data]);

	useEffect(() => {
		const status = job.data?.status;
		if (
			!jobId ||
			isRunning ||
			hasRequestedContext ||
			(status !== 'syncing' && status !== 'registering' && status !== 'awaiting_context') ||
			notifiedJobId.current === jobId
		) {
			return;
		}

		notifiedJobId.current = jobId;
		setOpen(false);
		void queueOrSendMessage({
			text: `${ONBOARDING_CONTEXT_REQUEST_PREFIX} jobId=${jobId}`,
		}).catch((error) => {
			if (notifiedJobId.current === jobId) {
				notifiedJobId.current = null;
			}
			console.error(error);
		});
	}, [hasRequestedContext, isRunning, job.data?.status, jobId, queueOrSendMessage]);

	if (!provider) {
		return null;
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen) {
					const cardBounds = cardRef.current?.getBoundingClientRect();
					setDialogCenter(cardBounds ? cardBounds.left + cardBounds.width / 2 : undefined);
				}
				setOpen(nextOpen);
			}}
		>
			<div
				ref={cardRef}
				className='animate-fade-in-up flex flex-col items-start justify-between gap-4 rounded-2xl border-2 border-emerald-500/60 bg-gradient-to-r from-emerald-50 via-emerald-50 to-background p-5 shadow-lg shadow-emerald-500/10 ring-4 ring-emerald-500/10 sm:flex-row sm:items-center dark:from-emerald-950 dark:via-emerald-950 dark:to-background'
			>
				<div className='flex min-w-0 items-center gap-3'>
					<div className='flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm'>
						<Database className='size-5' />
					</div>
					<div className='min-w-0'>
						<div className='mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300'>
							Action required
						</div>
						<div className='font-medium'>{WAREHOUSE_PROVIDER_LABELS[provider]} credentials required</div>
						<p className='text-xs text-muted-foreground'>
							Credentials are submitted securely and are never shared with the agent.
						</p>
					</div>
				</div>
				<DialogTrigger asChild>
					<Button className='w-full shrink-0 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 sm:w-auto dark:bg-emerald-600 dark:hover:bg-emerald-500'>
						Enter credentials
					</Button>
				</DialogTrigger>
			</div>
			<DialogContent
				className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
				style={dialogCenter === undefined ? undefined : { left: dialogCenter }}
			>
				<DialogHeader className='pr-8'>
					<div className='flex items-start gap-3 text-left'>
						<div className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'>
							<Database className='size-5' />
						</div>
						<div className='space-y-1'>
							<DialogTitle>Connect {WAREHOUSE_PROVIDER_LABELS[provider]}</DialogTitle>
							<DialogDescription>Add a secure connection for your nao project.</DialogDescription>
						</div>
					</div>
				</DialogHeader>
				{jobId ? (
					<WarehouseProvisioningProgress
						job={job}
						onRetry={() => {
							setJobId(null);
							startProvisioning.reset();
						}}
					/>
				) : isSqlProvider(provider) ? (
					<WarehouseCredentialsForm
						provider={provider}
						onSubmit={async (values) => {
							await startProvisioning.mutateAsync({
								name: values.name,
								provider,
								credentials: buildWarehouseCredentials(provider, values),
								...(canRestoreJob && { onboardingChatId: chatId }),
							});
						}}
						onCancel={() => setOpen(false)}
						isPending={startProvisioning.isPending}
						error={startProvisioning.error}
					/>
				) : (
					<div className='rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground'>
						{WAREHOUSE_PROVIDER_LABELS[provider]} connection setup is not available yet.
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function useWarehouseProvisioningJob(jobId: string | null) {
	return useQuery({
		...trpc.onboarding.getWarehouseProvisioningStatus.queryOptions({ jobId: jobId ?? '' }),
		enabled: jobId !== null,
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			return status === 'ready' || status === 'failed' || status === 'cancelled' ? false : 1000;
		},
	});
}

function WarehouseProvisioningProgress({
	job,
	onRetry,
}: {
	job: ReturnType<typeof useWarehouseProvisioningJob>;
	onRetry: () => void;
}) {
	if (job.isError) {
		return <FormError error={job.error.message} />;
	}

	if (job.data?.status === 'failed' || job.data?.status === 'cancelled') {
		return (
			<div className='flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4'>
				<FormError error={job.data.error ?? 'Warehouse setup failed.'} />
				<Button variant='outline' size='sm' onClick={onRetry}>
					Try again
				</Button>
			</div>
		);
	}

	const statusLabel = {
		queued: 'Preparing warehouse setup…',
		initializing: 'Initializing your nao project…',
		syncing: 'Syncing warehouse metadata…',
		awaiting_context: 'Collecting business context…',
		finalizing: 'Finalizing your connection…',
		registering: 'Registering your project…',
		publishing: 'Publishing your project…',
		failed: 'Warehouse setup failed. Please try again.',
		cancelled: 'Warehouse setup was cancelled.',
		ready: 'Connection ready. Opening your project…',
	}[job.data?.status ?? 'queued'];

	return (
		<div className='flex items-center gap-3 rounded-lg border bg-muted/30 p-4'>
			<Loader2 className='size-4 animate-spin text-primary' />
			<p className='text-sm'>{statusLabel}</p>
		</div>
	);
}
