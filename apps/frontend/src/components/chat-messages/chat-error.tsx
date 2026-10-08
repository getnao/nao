import { useQuery } from '@tanstack/react-query';
import { AlertCircleIcon, CheckIcon, CopyIcon, CreditCardIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Callout } from '../ui/callout';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useOpenOrganizationBilling } from '@/hooks/use-open-organization-billing';
import { parseBudgetError, parseManagedCreditsError } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export interface Props {
	className?: string;
}

type ParsedError = {
	error?: string;
	message?: string;
	requestId?: string;
};

function parseError(error: Error): ParsedError {
	try {
		const parsed = JSON.parse(error.message);
		const nested = parsed?.error;
		if (nested && typeof nested === 'object') {
			return {
				error: asString(nested.code) ?? asString(nested.type),
				message: asString(nested.message) ?? asString(parsed.message) ?? error.message,
				requestId: asString(nested.requestId),
			};
		}
		return {
			error: asString(nested),
			message: asString(parsed?.message),
		};
	} catch {
		return { message: error.message };
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function ChatError({ className }: Props) {
	const { error, isRunning, resendMessage, clearError } = useAgentContext();
	const messages = useAgentMessages();
	const { isCopied, copy } = useCopyToClipboard();
	const openOrganizationBilling = useOpenOrganizationBilling();
	const parsed = error ? parseError(error) : null;
	const isBillingAccessError = isCloudBillingAccessError(parsed);
	const billingAccess = useQuery({
		...trpc.billing.getAccess.queryOptions(),
		enabled: isBillingAccessError,
	});

	if (!error || parseBudgetError(error) || parseManagedCreditsError(error)) {
		return null;
	}

	const requestId = parsed?.requestId;
	const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
	const retry = async () => {
		if (!lastUserMessage) {
			return;
		}

		clearError();
		await resendMessage({ messageId: lastUserMessage.id });
	};

	if (isBillingAccessError) {
		return (
			<BillingAccessError
				access={billingAccess.data}
				className={className}
				isRunning={isRunning}
				isAccessPending={billingAccess.isPending}
				isAccessError={billingAccess.isError}
				isAccessFetching={billingAccess.isFetching}
				canRetry={Boolean(lastUserMessage)}
				onManageBilling={(organizationId) => void openOrganizationBilling(organizationId)}
				onRetryAccess={() => void billingAccess.refetch()}
				onRetry={() => void retry()}
			/>
		);
	}

	return (
		<div className={cn('flex items-start gap-2.5 px-4 py-3 text-red-500', className)}>
			<AlertCircleIcon className='size-4 shrink-0 mt-1' />

			<div className='flex-1 min-w-0 text-sm wrap-break-word'>
				{parsed?.error && <span className='font-medium'>{parsed.error}</span>}
				{parsed?.message && <p className='text-red-400 mt leading-relaxed'>{parsed.message}</p>}
				{requestId && (
					<div className='mt-2 flex items-center gap-1 text-xs text-muted-foreground'>
						<span>Provider request ID:</span>
						<code className='min-w-0 max-w-64 truncate' title={requestId}>
							{requestId}
						</code>
						<Button
							variant='ghost'
							size='icon-sm'
							aria-label='Copy provider request ID'
							onClick={() => {
								void copy(requestId);
							}}
						>
							{isCopied ? <CheckIcon /> : <CopyIcon />}
						</Button>
					</div>
				)}
				{lastUserMessage && (
					<Button
						variant='outline'
						size='sm'
						className='mt-3'
						disabled={isRunning}
						onClick={() => {
							void retry();
						}}
					>
						<RotateCcwIcon />
						Retry
					</Button>
				)}
			</div>
		</div>
	);
}

function BillingAccessError({
	access,
	className,
	isRunning,
	isAccessPending,
	isAccessError,
	isAccessFetching,
	canRetry,
	onManageBilling,
	onRetryAccess,
	onRetry,
}: {
	access:
		| {
				organizationId: string;
				canManageBilling: boolean;
				trialAvailable: boolean;
		  }
		| undefined;
	className?: string;
	isRunning: boolean;
	isAccessPending: boolean;
	isAccessError: boolean;
	isAccessFetching: boolean;
	canRetry: boolean;
	onManageBilling: (organizationId: string) => void;
	onRetryAccess: () => void;
	onRetry: () => void;
}) {
	return (
		<Callout icon={CreditCardIcon} className={cn('px-4 py-3 text-sm', className)} role='status'>
			<p className='font-medium text-foreground'>A subscription is needed to continue chatting.</p>
			<p className='mt-1 text-muted-foreground'>
				{isAccessPending
					? 'Loading billing details...'
					: isAccessError
						? 'Billing details could not be loaded.'
						: access?.trialAvailable
							? access.canManageBilling
								? 'Start your free trial, then retry your message.'
								: 'Ask an organization admin to start the free trial, then retry your message.'
							: 'Manage your subscription, then retry your message.'}
			</p>
			<div className='mt-3 flex flex-wrap gap-2'>
				{access?.canManageBilling && (
					<Button size='sm' onClick={() => onManageBilling(access.organizationId)}>
						Manage billing
					</Button>
				)}
				{isAccessError && (
					<Button size='sm' disabled={isAccessFetching} onClick={onRetryAccess}>
						<RotateCcwIcon />
						Retry billing details
					</Button>
				)}
				{canRetry && (
					<Button variant='secondary' size='sm' disabled={isRunning} onClick={onRetry}>
						<RotateCcwIcon />
						Retry
					</Button>
				)}
			</div>
			{access && !access.canManageBilling && (
				<p className='mt-2 text-xs text-muted-foreground'>Ask an organization admin to manage billing.</p>
			)}
		</Callout>
	);
}

function isCloudBillingAccessError(error: ParsedError | null): boolean {
	return [error?.error, error?.message].some((value) => value?.includes('Cloud billing access is restricted'));
}
