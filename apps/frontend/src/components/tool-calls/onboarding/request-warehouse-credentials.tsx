import { generateOnboardingRules } from '@nao/shared/tools';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { buildWarehouseCredentials } from './warehouse-credentials';
import { WarehouseCredentialsForm } from './warehouse-credentials-form';
import { isSqlProvider, WAREHOUSE_PROVIDER_LABELS } from './warehouse-provider-config';
import { FloatingConnectionSummary } from './floating-connection-summary';
import {
	describeCurrentSetupStep,
	isBusinessContextRequested,
	isStoppedStatus,
	WarehouseSetupProgress,
} from './warehouse-setup-progress';
import type { WarehouseCredentialsFormValues } from './warehouse-credentials';
import type { WarehouseSetupJob } from './warehouse-setup-progress';
import type { ToolCallComponentProps } from '..';
import type { UIMessage } from '@nao/backend/chat';
import type { requestWarehouseCredentials } from '@nao/shared/tools';

import { Button } from '@/components/ui/button';
import { DatabaseIcon } from '@/components/ui/database-icon';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { OnboardingFloatingContent } from '@/contexts/onboarding/onboarding-floating-slot';
import { useIsScrolledAbove } from '@/hooks/use-is-scrolled-above';
import { NEW_CHAT_ID } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type Provider = requestWarehouseCredentials.Provider;
type CardState = 'required' | 'running' | 'stopped' | 'ready';

const RUNNING_POLL_INTERVAL_MS = 1_000;
const IDLE_POLL_INTERVAL_MS = 5_000;

const CARD_COPY: Record<CardState, { title: (label: string) => string; description: string }> = {
	required: {
		title: (label) => `Connect ${label}`,
		description: 'Credentials are sent securely to nao and are never shared with the agent.',
	},
	running: {
		title: (label) => `Setting up ${label}`,
		description: 'This runs in the background. You can keep chatting meanwhile.',
	},
	stopped: {
		title: (label) => `${label} setup needs attention`,
		description: 'Review what went wrong, then retry or edit the connection details.',
	},
	ready: {
		title: (label) => `${label} connected`,
		description: 'Your warehouse connection is ready.',
	},
};

export function RequestWarehouseCredentialsToolCall({
	toolPart,
}: ToolCallComponentProps<'request_warehouse_credentials'>) {
	const provider = toolPart.input?.provider;
	const isLatestRequest = useAgentMessagesSelector((messages) => {
		const latestRequestId = findLatestCredentialsRequestId(messages);
		return latestRequestId === null || latestRequestId === toolPart.toolCallId;
	});

	if (!provider) {
		return null;
	}
	if (!isLatestRequest) {
		return <ReplacedConnectionCard provider={provider} />;
	}
	return <WarehouseConnectionCard provider={provider} />;
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

function WarehouseConnectionCard({ provider }: { provider: Provider }) {
	const { chatId, queueOrSendMessage } = useAgentContext();
	const queryClient = useQueryClient();
	const onboardingChatId = chatId && chatId !== NEW_CHAT_ID ? chatId : null;
	const latestSetup = useLatestWarehouseSetup(onboardingChatId);
	const job = latestSetup.data?.provider === provider ? latestSetup.data : null;
	const [isEditing, setIsEditing] = useState(false);
	const [businessContextSkippedJobId, setBusinessContextSkippedJobId] = useState<string | null>(null);
	const isBusinessContextSkipped = job !== null && businessContextSkippedJobId === job.id;
	const [credentialValues, setCredentialValues] = useState<WarehouseCredentialsFormValues>();
	const validateCredentials = useMutation(trpc.onboarding.validateWarehouseCredentials.mutationOptions());
	const startSetup = useMutation(trpc.onboarding.startWarehouseProvisioning.mutationOptions());
	const retrySetup = useMutation(trpc.onboarding.retryWarehouseProvisioning.mutationOptions());
	const label = WAREHOUSE_PROVIDER_LABELS[provider];
	const showForm = !job || isEditing;
	const cardState = showForm ? 'required' : getSetupCardState(job);
	const copy = CARD_COPY[cardState];
	const [cardElement, setCardElement] = useState<HTMLElement | null>(null);
	const isCardScrolledAbove = useIsScrolledAbove(cardElement);

	const refreshSetup = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.onboarding.getLatestWarehouseProvisioningJob.queryKey({
				onboardingChatId: onboardingChatId ?? '',
			}),
		});

	const reportToAgent = (text: string) => {
		queueOrSendMessage({ text }).catch(console.error);
	};

	const connect = async (values: WarehouseCredentialsFormValues) => {
		if (!onboardingChatId) {
			return;
		}
		const credentials = buildWarehouseCredentials(provider, values);
		try {
			await validateCredentials.mutateAsync({ provider, credentials });
			await startSetup.mutateAsync({ provider, credentials, onboardingChatId });
		} catch {
			return;
		}
		setIsEditing(false);
		await refreshSetup();
		reportToAgent(`I submitted my ${label} connection details.`);
	};

	const retry = async () => {
		if (!onboardingChatId) {
			return;
		}
		try {
			await retrySetup.mutateAsync({ onboardingChatId });
		} catch {
			return;
		}
		await refreshSetup();
		reportToAgent(`I restarted the ${label} setup.`);
	};

	const skipBusinessContext = () => {
		setBusinessContextSkippedJobId(job?.id ?? null);
		reportToAgent(generateOnboardingRules.SKIP_MESSAGE);
	};

	const editConnectionDetails = () => {
		validateCredentials.reset();
		startSetup.reset();
		retrySetup.reset();
		setIsEditing(true);
	};

	const setupJob = showForm ? null : job;

	return (
		<>
			{isCardScrolledAbove && cardState !== 'ready' && (
				<OnboardingFloatingContent>
					<FloatingConnectionSummary
						provider={provider}
						title={copy.title(label)}
						detail={setupJob ? describeCurrentSetupStep(setupJob) : 'Enter your connection details'}
						tone={cardState === 'stopped' ? 'error' : 'neutral'}
						action={
							setupJob && (
								<FloatingSetupAction
									job={setupJob}
									onRetry={retry}
									isRetrying={retrySetup.isPending}
									onSkipBusinessContext={skipBusinessContext}
									isBusinessContextSkipped={isBusinessContextSkipped}
								/>
							)
						}
						onShow={() => cardElement?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
					/>
				</OnboardingFloatingContent>
			)}
			<section
				ref={setCardElement}
				aria-label={`${label} connection`}
				className={cn(
					'animate-fade-in-up flex flex-col gap-5 rounded-xl border bg-background p-5',
					cardState === 'ready' && 'border-emerald-500/25',
					cardState === 'stopped' && 'border-destructive/25',
					(cardState === 'required' || cardState === 'running') && 'border-violet/20',
				)}
			>
				<div className='flex min-w-0 items-center gap-3'>
					<div
						className={cn(
							'flex size-10 shrink-0 items-center justify-center rounded-lg border',
							cardState === 'ready'
								? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
								: 'border-violet/20 bg-violet/10 text-primary',
						)}
					>
						<DatabaseIcon dialect={provider} className='size-5' />
					</div>
					<div className='min-w-0'>
						<h3 className='font-borna text-lg font-medium tracking-tight text-foreground'>
							{copy.title(label)}
						</h3>
						<p className='text-xs text-muted-foreground'>{copy.description}</p>
					</div>
				</div>
				{onboardingChatId && latestSetup.isPending ? null : showForm ? (
					isSqlProvider(provider) ? (
						<WarehouseCredentialsForm
							provider={provider}
							onSubmit={connect}
							onCancel={job ? () => setIsEditing(false) : undefined}
							isValidating={validateCredentials.isPending}
							isPending={startSetup.isPending}
							error={validateCredentials.error ?? startSetup.error}
							initialValues={credentialValues}
							onValuesChange={setCredentialValues}
						/>
					) : (
						<p className='text-sm text-muted-foreground'>{label} connection setup is not available yet.</p>
					)
				) : (
					job && (
						<WarehouseSetupProgress
							job={job}
							onRetry={retry}
							onEdit={editConnectionDetails}
							isRetrying={retrySetup.isPending}
							retryError={retrySetup.error?.message ?? null}
							onSkipBusinessContext={skipBusinessContext}
							isBusinessContextSkipped={isBusinessContextSkipped}
						/>
					)
				)}
			</section>
		</>
	);
}

function FloatingSetupAction({
	job,
	onRetry,
	isRetrying,
	onSkipBusinessContext,
	isBusinessContextSkipped,
}: {
	job: WarehouseSetupJob;
	onRetry: () => void;
	isRetrying: boolean;
	onSkipBusinessContext: () => void;
	isBusinessContextSkipped: boolean;
}) {
	if (isStoppedStatus(job.status) && job.canRetry) {
		return (
			<Button
				size='sm'
				className='h-7 shrink-0 rounded-full px-2.5 text-xs'
				onClick={onRetry}
				isLoading={isRetrying}
			>
				Retry
			</Button>
		);
	}
	if (isBusinessContextRequested(job) && !isBusinessContextSkipped) {
		return (
			<Button
				variant='outline'
				size='sm'
				className='h-7 shrink-0 rounded-full px-2.5 text-xs'
				onClick={onSkipBusinessContext}
			>
				Skip for now
			</Button>
		);
	}
	return null;
}

function ReplacedConnectionCard({ provider }: { provider: Provider }) {
	return (
		<div className='flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground'>
			<DatabaseIcon dialect={provider} className='size-4 shrink-0' />
			<span>{WAREHOUSE_PROVIDER_LABELS[provider]} connection form replaced by a newer one.</span>
		</div>
	);
}

function useLatestWarehouseSetup(onboardingChatId: string | null) {
	return useQuery({
		...trpc.onboarding.getLatestWarehouseProvisioningJob.queryOptions({
			onboardingChatId: onboardingChatId ?? '',
		}),
		enabled: onboardingChatId !== null,
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (status === 'ready') {
				return false;
			}
			return status && !isStoppedStatus(status) ? RUNNING_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
		},
	});
}

function getSetupCardState(job: WarehouseSetupJob): CardState {
	if (job.status === 'ready') {
		return 'ready';
	}
	return isStoppedStatus(job.status) ? 'stopped' : 'running';
}

function findLatestCredentialsRequestId(messages: UIMessage[]): string | null {
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
		const parts = messages[messageIndex].parts;
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
			const part = parts[partIndex];
			if (part.type === 'tool-request_warehouse_credentials') {
				return part.toolCallId;
			}
		}
	}
	return null;
}
