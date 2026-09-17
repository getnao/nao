import { Check, X } from 'lucide-react';
import { useState } from 'react';
import type { callSubagent } from '@nao/shared/tools';
import { Expandable } from '@/components/ui/expandable';
import { Spinner } from '@/components/ui/spinner';
import { useSubagentDuration } from '@/components/subagent/use-subagent-duration';

/** The tool calls a subagent made, folded behind a one-line "Worked for …" summary. */
export function SubagentWork({ output, isSettled }: { output: callSubagent.Output | undefined; isSettled: boolean }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const duration = useSubagentDuration(output, isSettled);
	const steps = output?.steps ?? [];
	const title = `${isSettled ? 'Worked' : 'Working'}${duration ? ` for ${duration}` : ''}`;

	return (
		<Expandable
			title={title}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			disabled={steps.length === 0}
			isLoading={!isSettled}
			variant='inline'
		>
			<ol className='flex flex-col gap-1 py-1'>
				{steps.map((step, index) => (
					<li key={index} className='flex items-center gap-2 min-w-0 text-xs'>
						<StepStatusIcon status={step.status} />
						<span className='font-mono text-foreground/60 shrink-0'>{step.tool}</span>
						<span className='text-foreground/80 truncate'>{step.summary}</span>
					</li>
				))}
			</ol>
		</Expandable>
	);
}

const StepStatusIcon = ({ status }: { status: callSubagent.Step['status'] }) => {
	switch (status) {
		case 'running':
			return <Spinner className='size-3 shrink-0' />;
		case 'done':
			return <Check size={12} className='shrink-0 text-foreground/40' />;
		case 'error':
			return <X size={12} className='shrink-0 text-red-500' />;
	}
};
