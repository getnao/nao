import { AlertCircleIcon, CheckIcon, CopyIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { parseBudgetError } from '@/lib/ai';
import { cn } from '@/lib/utils';

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

	if (!error || parseBudgetError(error)) {
		return null;
	}

	const parsed = parseError(error);
	const requestId = parsed.requestId;
	const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
	const retry = async () => {
		if (!lastUserMessage) {
			return;
		}

		clearError();
		await resendMessage({ messageId: lastUserMessage.id });
	};

	return (
		<div className={cn('flex items-start gap-2.5 px-4 py-3 text-red-500', className)}>
			<AlertCircleIcon className='size-4 shrink-0 mt-1' />

			<div className='flex-1 min-w-0 text-sm wrap-break-word'>
				{parsed.error && <span className='font-medium'>{parsed.error}</span>}
				{parsed.message && <p className='text-red-400 mt leading-relaxed'>{parsed.message}</p>}
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
