import { callSubagent } from '@nao/shared/tools';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import type { ToolCallComponentProps } from '.';
import { useSubagentDuration } from '@/components/subagent/use-subagent-duration';
import { Spinner } from '@/components/ui/spinner';
import { useToolCallContext } from '@/contexts/tool-call';
import { useIsInToolGroup } from '@/contexts/tool-group';
import { useChatId } from '@/hooks/use-chat-id';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { cn } from '@/lib/utils';

/** A subagent run summarised in the conversation; clicking it opens the run as its own conversation. */
export const CallSubagentToolCall = ({
	toolPart: { input, output, errorText, toolCallId },
}: ToolCallComponentProps<'call_subagent'>) => {
	const { isSettled } = useToolCallContext();
	const isInToolGroup = useIsInToolGroup();
	const [density] = useToolCallDensity();
	const chatId = useChatId();
	const duration = useSubagentDuration(output, isSettled);
	const summary: RunSummary = {
		label: subagentLabel(input?.subagent),
		prompt: input?.prompt,
		report: output?.report,
		errorText,
		isSettled,
		work: `${isSettled ? 'Worked' : 'Working'}${duration ? ` for ${duration}` : ''}`,
		canOpen: !!chatId,
	};
	const isCompact = density === 'compact' || isInToolGroup;
	const content = isCompact ? <CompactRow summary={summary} /> : <Card summary={summary} />;

	return (
		<div className={cn(!isCompact && '-mx-3')} data-replay-target-id={toolCallId}>
			{chatId ? (
				<Link to='/$chatId/subagent/$toolCallId' params={{ chatId, toolCallId }} className='block'>
					{content}
				</Link>
			) : (
				content
			)}
		</div>
	);
};

interface RunSummary {
	label: string;
	prompt: string | undefined;
	report: string | undefined;
	errorText: string | undefined;
	isSettled: boolean;
	work: string;
	canOpen: boolean;
}

const Card = ({ summary }: { summary: RunSummary }) => {
	const hasError = !!summary.errorText;
	return (
		<div
			className={cn(
				'flex flex-col gap-2 rounded-lg border border-border bg-backgroundSecondary/30 px-3 py-2.5 text-sm transition-colors',
				summary.canOpen && 'cursor-pointer hover:bg-accent/40',
			)}
		>
			<div className='flex items-center gap-2 min-w-0'>
				<StatusIcon summary={summary} />
				<span className={cn('font-medium truncate', !summary.isSettled && 'text-shimmer')}>
					{summary.label} subagent
				</span>
				<span className='ml-auto shrink-0 text-xs text-muted-foreground'>{summary.work}</span>
				{summary.canOpen && <ArrowUpRight className='size-3.5 shrink-0 text-muted-foreground' />}
			</div>
			{summary.prompt && <p className='text-foreground/70 italic line-clamp-2'>{summary.prompt}</p>}
			{hasError ? (
				<p className='text-xs text-red-500 line-clamp-2'>{summary.errorText}</p>
			) : (
				summary.isSettled &&
				summary.report && (
					<p className='text-xs text-muted-foreground line-clamp-3'>{toPlainText(summary.report)}</p>
				)
			)}
		</div>
	);
};

const CompactRow = ({ summary }: { summary: RunSummary }) => {
	return (
		<div className={cn('flex items-center gap-2 min-w-0 px-2 text-sm', summary.canOpen && 'cursor-pointer')}>
			<div className='size-3 flex items-center justify-center shrink-0'>
				<LeadingIcon summary={summary} />
			</div>
			<span className={cn('shrink-0 font-medium', !summary.isSettled && 'text-shimmer')}>
				{summary.label} subagent
			</span>
			{summary.prompt && <span className='truncate text-muted-foreground'>{summary.prompt}</span>}
		</div>
	);
};

const StatusIcon = ({ summary }: { summary: RunSummary }) => {
	if (!summary.isSettled) {
		return <Spinner className='size-3 shrink-0' />;
	}
	if (summary.errorText) {
		return <div className='size-2 shrink-0 rounded-full bg-red-500' />;
	}
	return null;
};

/** Sits where other tools show their chevron, so compact rows line up in a group. */
const LeadingIcon = ({ summary }: { summary: RunSummary }) => {
	if (!summary.isSettled || summary.errorText) {
		return <StatusIcon summary={summary} />;
	}
	return summary.canOpen ? <ArrowUpRight size={12} strokeWidth={2.5} /> : null;
};

export function subagentLabel(name: callSubagent.SubagentName | undefined): string {
	return name ? callSubagent.SUBAGENT_LABELS[name] : 'Subagent';
}

/** Strips markdown markers so a report excerpt reads as plain text. */
function toPlainText(markdown: string): string {
	return markdown
		.replace(/^#+\s*/gm, '')
		.replace(/[*_`>]/g, '')
		.replace(/^\s*[-+]\s+/gm, '')
		.replace(/\n{2,}/g, '\n')
		.trim();
}
