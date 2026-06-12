import { AlertCircleIcon } from 'lucide-react';

import { useAgentContext } from '@/contexts/agent.provider';
import { parseBudgetError } from '@/lib/ai';
import { cn } from '@/lib/utils';

export interface Props {
	className?: string;
}

type ParsedError = {
	error?: string;
	message?: string;
};

function parseError(error: Error): ParsedError {
	try {
		const parsed = JSON.parse(error.message);
		const nested = parsed?.error;
		if (nested && typeof nested === 'object') {
			return {
				error: asString(nested.code) ?? asString(nested.type),
				message: asString(nested.message) ?? asString(parsed.message) ?? error.message,
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
	const { error } = useAgentContext();

	if (!error || parseBudgetError(error)) {
		return null;
	}

	const parsed = parseError(error);

	return (
		<div className={cn('flex items-start gap-2.5 px-4 py-3 text-red-500', className)}>
			<AlertCircleIcon className='size-4 shrink-0 mt-1' />

			<div className='flex-1 min-w-0 text-sm wrap-break-word'>
				{parsed.error && <span className='font-medium'>{parsed.error}</span>}
				{parsed.message && <p className='text-red-400 mt leading-relaxed'>{parsed.message}</p>}
			</div>
		</div>
	);
}
