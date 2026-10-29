import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { buildWarehouseCredentials } from './warehouse-credentials';
import { RequestBusinessContext } from './request-business-context';
import { WarehouseCredentialsForm } from './warehouse-credentials-form';
import { isSqlProvider, WAREHOUSE_PROVIDER_LABELS } from './warehouse-provider-config';
import {
	getAllWarehouseTableKeys,
	getCompactWarehouseTableSelection,
	WarehouseTableSelection,
} from './warehouse-table-selection';
import type { WarehouseCredentialsFormValues } from './warehouse-credentials';
import type { WarehouseSchemaInventory, WarehouseTableSelectionMode } from './warehouse-table-selection';
import type { ToolCallComponentProps } from '.';
import type { TabBarItem } from '@/components/ui/tab-bar';

import { Button } from '@/components/ui/button';
import { DatabaseIcon } from '@/components/ui/database-icon';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-fields';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { findWarehouseJobId } from '@/components/onboarding-progress';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { getMessageText, NEW_CHAT_ID, ONBOARDING_CONTEXT_REQUEST_PREFIX } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export { WarehouseCredentialsForm as SqlCredentialsForm } from './warehouse-credentials-form';

type SetupStep = 'credentials' | 'tables';

export function RequestWarehouseCredentialsToolCall({
	toolPart,
}: ToolCallComponentProps<'request_warehouse_credentials'>) {
	const provider = toolPart.input?.provider;
	const [open, setOpen] = useState(false);
	const [jobId, setJobId] = useState<string | null>(null);
	const [dialogCenter, setDialogCenter] = useState<number>();
	const [credentialValues, setCredentialValues] = useState<WarehouseCredentialsFormValues>();
	const [validatedCredentialFingerprint, setValidatedCredentialFingerprint] = useState<string | null>(null);
	const [setupStep, setSetupStep] = useState<SetupStep>('credentials');
	const [discoveredSchemas, setDiscoveredSchemas] = useState<WarehouseSchemaInventory[]>();
	const [tableSelectionMode, setTableSelectionMode] = useState<WarehouseTableSelectionMode>('all');
	const [selectedTableKeys, setSelectedTableKeys] = useState<Set<string>>(new Set());
	const cardRef = useRef<HTMLDivElement>(null);
	const notifiedJobId = useRef<string | null>(null);
	const restoredJobId = useRef(false);
	const { chatId, isRunning, queueOrSendMessage } = useAgentContext();
	const queryClient = useQueryClient();
	const canRestoreJob = Boolean(chatId && chatId !== NEW_CHAT_ID);
	const alignDialog = useCallback(() => {
		const cardBounds = cardRef.current?.getBoundingClientRect();
		setDialogCenter(cardBounds ? cardBounds.left + cardBounds.width / 2 : undefined);
	}, []);
	const activeJob = useQuery({
		...trpc.onboarding.getActiveWarehouseProvisioningJob.queryOptions({
			onboardingChatId: canRestoreJob ? chatId! : '',
		}),
		enabled: canRestoreJob,
	});
	const persistedJobId = useAgentMessagesSelector(findWarehouseJobId);
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
	const validateCredentials = useMutation(trpc.onboarding.validateWarehouseCredentials.mutationOptions());
	const startProvisioning = useMutation(
		trpc.onboarding.startWarehouseProvisioning.mutationOptions({
			onSuccess: ({ jobId: nextJobId }) => {
				setJobId(nextJobId);
				if (canRestoreJob) {
					void queryClient.invalidateQueries({
						queryKey: trpc.onboarding.getActiveWarehouseProvisioningJob.queryKey({
							onboardingChatId: chatId!,
						}),
					});
				}
			},
		}),
	);

	useEffect(() => {
		if (canRestoreJob && !activeJob.isFetched) {
			return;
		}
		const restoredId = activeJob.data && activeJob.data.provider === provider ? activeJob.data.id : persistedJobId;
		if (restoredJobId.current || !restoredId) {
			return;
		}
		restoredJobId.current = true;
		setJobId(restoredId);
	}, [activeJob.data, activeJob.isFetched, canRestoreJob, persistedJobId, provider]);

	useEffect(() => {
		if (job.data && job.data.provider !== provider) {
			setJobId(null);
		}
	}, [job.data, provider]);

	useEffect(() => {
		const status = job.data?.status;
		if (
			!jobId ||
			job.data?.provider !== provider ||
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
	}, [hasRequestedContext, isRunning, job.data?.provider, job.data?.status, jobId, provider, queueOrSendMessage]);

	useEffect(() => {
		if (!open) {
			return;
		}

		alignDialog();
		window.addEventListener('resize', alignDialog);
		return () => window.removeEventListener('resize', alignDialog);
	}, [alignDialog, open]);

	if (!provider) {
		return null;
	}

	const setupReady = job.data?.status === 'ready';
	const setupFailed = job.isError || job.data?.status === 'failed' || job.data?.status === 'cancelled';
	const setupInProgress = startProvisioning.isPending || (jobId !== null && !setupReady && !setupFailed);
	const credentialsVerified =
		validatedCredentialFingerprint !== null &&
		credentialValues !== undefined &&
		validatedCredentialFingerprint === JSON.stringify(credentialValues);
	const setupStepsUnlocked = credentialsVerified && discoveredSchemas !== undefined;
	const tableSelectionReady = setupStep === 'tables' && discoveredSchemas !== undefined && !setupInProgress;
	const awaitingSources = job.data?.status === 'awaiting_sources';
	const credentialsAccepted = credentialsVerified || setupInProgress || setupReady;
	const credentialDetailsUnavailable = jobId !== null && credentialValues === undefined;
	const startSelectedProvisioning = async () => {
		if (!credentialValues || !discoveredSchemas) {
			return;
		}
		const selected = getCompactWarehouseTableSelection(discoveredSchemas, selectedTableKeys);
		await startProvisioning.mutateAsync({
			provider,
			credentials: buildWarehouseCredentials(provider, credentialValues),
			tableSelection:
				tableSelectionMode === 'all'
					? { mode: 'all' }
					: {
							mode: 'selected',
							...(selected.schemas.length > 0 && { schemas: selected.schemas }),
							tables: selected.tables,
						},
			...(canRestoreJob && { onboardingChatId: chatId }),
		});
	};

	return (
		<div className='space-y-3'>
			<Dialog open={open} onOpenChange={setOpen}>
				<div
					ref={cardRef}
					className={cn(
						'animate-fade-in-up flex flex-col items-start justify-between gap-4 rounded-xl border bg-background p-5 shadow-xs sm:flex-row sm:items-center',
						setupFailed
							? 'border-destructive/20'
							: credentialsAccepted
								? 'border-emerald-500/25'
								: 'border-violet/20',
					)}
				>
					<div className='flex min-w-0 items-center gap-3'>
						<div
							className={cn(
								'flex size-10 shrink-0 items-center justify-center rounded-lg border',
								setupFailed
									? 'border-destructive/20 bg-destructive/5 text-destructive'
									: credentialsAccepted
										? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
										: 'border-violet/20 bg-violet/10 text-primary',
							)}
						>
							<DatabaseIcon dialect={provider} className='size-5' />
						</div>
						<div className='min-w-0'>
							<div className='font-borna text-lg font-medium tracking-tight text-foreground'>
								{setupFailed
									? `${WAREHOUSE_PROVIDER_LABELS[provider]} setup needs attention`
									: setupReady
										? `${WAREHOUSE_PROVIDER_LABELS[provider]} credentials verified`
										: awaitingSources
											? `${WAREHOUSE_PROVIDER_LABELS[provider]} database verified`
											: tableSelectionReady
												? `${WAREHOUSE_PROVIDER_LABELS[provider]} tables ready`
												: credentialsAccepted
													? `${WAREHOUSE_PROVIDER_LABELS[provider]} credentials verified`
													: `${WAREHOUSE_PROVIDER_LABELS[provider]} credentials required`}
							</div>
							<p className='text-xs text-muted-foreground'>
								{setupFailed
									? 'Open the setup to review the problem and try again.'
									: setupReady
										? 'Your warehouse connection is ready.'
										: awaitingSources
											? 'Your credentials and table selection are ready.'
											: setupInProgress
												? 'Your connection is being set up.'
												: tableSelectionReady
													? 'Review which tables nao should sync.'
													: credentialsVerified
														? 'Ready to continue. You can still review or edit these details.'
														: 'Credentials are submitted securely and are never shared with the agent.'}
							</p>
						</div>
					</div>
					<DialogTrigger asChild>
						<Button
							variant={credentialsAccepted || setupFailed ? 'outline' : 'default'}
							className={cn(
								'w-full shrink-0 rounded-full sm:w-auto',
								setupFailed &&
									'border-destructive/25 text-destructive hover:bg-destructive/5 hover:text-destructive',
								credentialsAccepted &&
									'border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-400',
							)}
						>
							{setupFailed
								? 'Review setup'
								: setupReady || setupInProgress
									? credentialDetailsUnavailable
										? 'View setup'
										: 'View progress'
									: tableSelectionReady
										? 'Choose tables'
										: credentialsVerified
											? 'Edit credentials'
											: 'Enter credentials'}
						</Button>
					</DialogTrigger>
				</div>
				<DialogContent
					className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
					overlayClassName='data-[state=open]:animate-none data-[state=closed]:animate-none'
					style={dialogCenter === undefined ? undefined : { left: dialogCenter }}
				>
					<DialogHeader className='pr-8'>
						<div className='flex items-start gap-3 text-left'>
							<div className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet'>
								<DatabaseIcon dialect={provider} className='size-5' />
							</div>
							<div className='space-y-1'>
								<DialogTitle>
									{jobId
										? `Set up ${WAREHOUSE_PROVIDER_LABELS[provider]}`
										: setupStep === 'tables'
											? `Choose ${WAREHOUSE_PROVIDER_LABELS[provider]} data`
											: `Connect ${WAREHOUSE_PROVIDER_LABELS[provider]}`}
								</DialogTitle>
								<DialogDescription>
									{jobId
										? 'Preparing your nao project and syncing metadata.'
										: setupStep === 'tables'
											? 'Choose the tables nao should use as context.'
											: 'Add a secure connection for your nao project.'}
								</DialogDescription>
							</div>
						</div>
					</DialogHeader>
					{!jobId && isSqlProvider(provider) && (
						<SetupStepNavigation
							activeStep={setupStep}
							unlocked={setupStepsUnlocked}
							selectedTableCount={selectedTableKeys.size}
							onStepChange={setSetupStep}
						/>
					)}
					{jobId && setupFailed ? (
						<WarehouseProvisioningProgress
							job={job}
							onRetry={() => {
								setJobId(null);
								startProvisioning.reset();
							}}
						/>
					) : jobId && credentialDetailsUnavailable && isSqlProvider(provider) ? (
						<div className='rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground'>
							Your connection details are unavailable in this session. The credentials remain securely
							stored for this connection.
						</div>
					) : jobId ? (
						<WarehouseProvisioningProgress
							job={job}
							onRetry={() => {
								setJobId(null);
								startProvisioning.reset();
							}}
						/>
					) : (
						<TabPanel idBase='warehouse-setup' tabId={setupStep}>
							{setupStep === 'tables' && discoveredSchemas ? (
								<WarehouseTableSelection
									schemas={discoveredSchemas}
									databaseType={provider}
									databaseLabel={WAREHOUSE_PROVIDER_LABELS[provider]}
									selectionMode={tableSelectionMode}
									selectedTableKeys={selectedTableKeys}
									isPending={startProvisioning.isPending}
									error={startProvisioning.error}
									onSelectionModeChange={setTableSelectionMode}
									onChange={setSelectedTableKeys}
									onBack={() => setSetupStep('credentials')}
									onSubmit={() => void startSelectedProvisioning()}
								/>
							) : isSqlProvider(provider) ? (
								<WarehouseCredentialsForm
									provider={provider}
									onValidate={async (values) => {
										const result = await validateCredentials.mutateAsync({
											provider,
											credentials: buildWarehouseCredentials(provider, values),
										});
										setDiscoveredSchemas(result.schemas);
										setTableSelectionMode('all');
										setSelectedTableKeys(getAllWarehouseTableKeys(result.schemas));
									}}
									onSubmit={async () => {
										if (discoveredSchemas) {
											setSetupStep('tables');
										}
									}}
									onCancel={() => setOpen(false)}
									isValidating={validateCredentials.isPending}
									isPending={startProvisioning.isPending}
									error={validateCredentials.error ?? startProvisioning.error}
									initialValues={credentialValues}
									onValuesChange={setCredentialValues}
									initialValidatedFingerprint={validatedCredentialFingerprint}
									onValidatedFingerprintChange={setValidatedCredentialFingerprint}
								/>
							) : (
								<div className='rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground'>
									{WAREHOUSE_PROVIDER_LABELS[provider]} connection setup is not available yet.
								</div>
							)}
						</TabPanel>
					)}
				</DialogContent>
			</Dialog>
			{awaitingSources && jobId && <RequestBusinessContext jobId={jobId} />}
		</div>
	);
}

function SetupStepNavigation({
	activeStep,
	unlocked,
	selectedTableCount,
	onStepChange,
}: {
	activeStep: SetupStep;
	unlocked: boolean;
	selectedTableCount: number;
	onStepChange: (step: SetupStep) => void;
}) {
	const tabs: TabBarItem<SetupStep>[] = [
		{ id: 'credentials', label: 'Credentials' },
		{
			id: 'tables',
			label: 'Tables',
			count: unlocked ? selectedTableCount : undefined,
			disabled: !unlocked,
			disabledReason: 'Validate credentials to unlock',
		},
	];

	return (
		<TabBar
			tabs={tabs}
			activeTab={activeStep}
			onTabChange={onStepChange}
			idBase='warehouse-setup'
			className='-mx-6 border-b px-6'
		/>
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
	const setupError = job.isError
		? job.error.message
		: job.data?.status === 'failed' || job.data?.status === 'cancelled'
			? (job.data.error ?? 'Warehouse setup failed.')
			: null;
	if (setupError) {
		return (
			<div className='flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4'>
				<FormError error={setupError} />
				<Button variant='outline' size='sm' onClick={onRetry}>
					Try again
				</Button>
			</div>
		);
	}

	if (job.data?.status === 'awaiting_sources') {
		return (
			<div className='flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4'>
				<CircleCheck className='size-4 text-emerald-600 dark:text-emerald-400' />
				<p className='text-sm'>Database verified. Continue with the business context card.</p>
			</div>
		);
	}

	const statusLabel = {
		queued: 'Preparing warehouse setup…',
		initializing: 'Initializing your nao project…',
		debugging: 'Checking your warehouse connection…',
		syncing: 'Syncing warehouse metadata…',
		awaiting_context: 'Collecting business context…',
		finalizing: 'Finalizing your connection…',
		registering: 'Registering your project…',
		publishing: 'Publishing your project…',
		failed: 'Warehouse setup failed. Please try again.',
		cancelled: 'Warehouse setup was cancelled.',
		ready: 'Connection ready.',
	}[job.data?.status ?? 'queued'];
	const isReady = job.data?.status === 'ready';

	return (
		<div className='flex items-center gap-3 rounded-lg border bg-muted/30 p-4'>
			{isReady ? (
				<CircleCheck className='size-4 text-emerald-600 dark:text-emerald-400' />
			) : (
				<Loader2 className='size-4 animate-spin text-primary' />
			)}
			<p className='text-sm'>{statusLabel}</p>
		</div>
	);
}
