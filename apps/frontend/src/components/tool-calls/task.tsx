import { task } from '@nao/shared/tools';
import { ArrowUpRight } from 'lucide-react';
import type { ToolCallComponentProps } from '.';
import { SubagentLink } from '@/components/subagent/subagent-link';
import { useSubagentDuration } from '@/components/subagent/use-subagent-duration';
import { Spinner } from '@/components/ui/spinner';
import { useToolCallContext } from '@/contexts/tool-call';
import { useIsInToolGroup } from '@/contexts/tool-group';
import { useChatId } from '@/hooks/use-chat-id';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { cn } from '@/lib/utils';

/** A subagent task summarised in the conversation; clicking it opens the run as its own conversation. */
export const TaskToolCall = ({
	toolPart: { input, output, errorText, toolCallId },
}: ToolCallComponentProps<'task'>) => {
	const { isSettled } = useToolCallContext();
	const isInToolGroup = useIsInToolGroup();
	const [density] = useToolCallDensity();
	const chatId = useChatId();
	const duration = useSubagentDuration(output, isSettled);
	const summary: RunSummary = {
		title: taskTitle(input),
		label: subagentLabel(input?.subagent_type),
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
				<SubagentLink chatId={chatId} toolCallId={toolCallId} className='block'>
					{content}
				</SubagentLink>
			) : (
				content
			)}
		</div>
	);
};

interface RunSummary {
	title: string;
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
					{summary.title}
				</span>
				<span className='ml-auto shrink-0 text-xs text-muted-foreground'>{summary.work}</span>
				{summary.canOpen && <ArrowUpRight className='size-3.5 shrink-0 text-muted-foreground' />}
			</div>
			{summary.prompt && <p className='text-foreground/70 italic line-clamp-2'>{summary.prompt}</p>}
			{hasError ? <p className='text-xs text-red-500 line-clamp-2'>{summary.errorText}</p> : null}
		</div>
	);
};

const CompactRow = ({ summary }: { summary: RunSummary }) => {
	return (
		<div className={cn('flex items-center gap-2 min-w-0 text-sm', summary.canOpen && 'cursor-pointer')}>
			<div className='size-3 flex items-center justify-center shrink-0'>
				<LeadingIcon summary={summary} />
			</div>
			<span className='flex items-baseline gap-2.5 min-w-0'>
				<span className={cn('shrink-0 text-foreground', !summary.isSettled && 'text-shimmer')}>
					{summary.label}
				</span>
				<span className='truncate text-xs text-muted-foreground'>{summary.title}</span>
			</span>
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

export function subagentLabel(type: task.SubagentType | undefined): string {
	return type ? task.SUBAGENT_LABELS[type] : 'Subagent';
}

/** The task description names the run; before it streams in, fall back to the subagent type. */
export function taskTitle(input: Partial<task.Input> | undefined): string {
	return input?.description || `${subagentLabel(input?.subagent_type)} subagent`;
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
