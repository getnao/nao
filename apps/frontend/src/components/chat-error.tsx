import { AlertCircleIcon } from 'lucide-react';

import { useAgentContext } from '@/contexts/agent.provider';
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
		return {
			error: parsed.error,
			message: parsed.message,
		};
	} catch {
		return { message: error.message };
	}
}

export function ChatError({ className }: Props) {
	const { error } = useAgentContext();

	if (!error) {
		return null;
	}

	const parsed = parseError(error);

	return (
		<div className={cn('flex items-start gap-2.5 px-4 py-3 text-red-500', className)}>
			<AlertCircleIcon className='size-4 shrink-0 mt-1' />

			<div className='flex-1 min-w-0 text-sm break-words'>
				{parsed.error && <span className='font-medium'>{parsed.error}</span>}
				{parsed.message && <p className='text-red-400 mt leading-relaxed'>{parsed.message}</p>}
			</div>
		</div>
	);
}
