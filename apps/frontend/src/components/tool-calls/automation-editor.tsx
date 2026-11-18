import { parseSlackChannels } from '@nao/shared/slack-channels';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { AutomationDraftField, AutomationDraftUpdateResult } from '@nao/shared/automation-draft';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';
import { describeNaoEventTrigger } from '@/lib/automation-triggers';

const FIELD_LABELS: Record<AutomationDraftField, string> = {
	title: 'title',
	prompt: 'instructions',
	schedule: 'schedule',
	webhook: 'webhook',
	feedback: 'feedback trigger',
	email: 'email delivery',
	slack: 'Slack delivery',
};

interface RunHistoryOutput {
	runs?: unknown[];
}

export const GetAutomationToolCall = () => {
	const { isSettled } = useToolCallContext();
	return <ToolCallWrapper title={isSettled ? 'Read the automation' : 'Reading the automation...'} />;
};

export const AutomationRunHistoryToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const runCount = (toolPart.output as RunHistoryOutput | undefined)?.runs?.length;
	const title = isSettled ? 'Read the past runs' : 'Reading the past runs...';
	return <ToolCallWrapper title={title} badge={runCount !== undefined && `${runCount} runs`} />;
};

export const UpdateAutomationToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const output = toolPart.output as AutomationDraftUpdateResult | undefined;

	if (!isSettled || !output) {
		return <ToolCallWrapper title={isSettled ? 'Could not update the automation' : 'Updating the automation...'} />;
	}

	return (
		<ToolCallWrapper title={`Updated the ${formatFieldList(output.changedFields)}`}>
			<dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 p-3 text-xs'>
				{output.changedFields.map((field) => (
					<UpdatedField key={field} field={field} result={output} />
				))}
			</dl>
		</ToolCallWrapper>
	);
};

function UpdatedField({ field, result }: { field: AutomationDraftField; result: AutomationDraftUpdateResult }) {
	return (
		<>
			<dt className='text-muted-foreground'>{capitalize(FIELD_LABELS[field])}</dt>
			<dd className='min-w-0'>
				{field === 'prompt' ? (
					<p className='max-h-48 overflow-auto whitespace-pre-wrap'>{result.update.prompt}</p>
				) : (
					<span className='break-words'>{describeUpdatedField(field, result)}</span>
				)}
			</dd>
		</>
	);
}

function describeUpdatedField(field: AutomationDraftField, { update }: AutomationDraftUpdateResult): string {
	switch (field) {
		case 'title':
			return update.title ?? '';
		case 'prompt':
			return update.prompt ?? '';
		case 'schedule':
			return update.cron ? `${update.scheduleDescription} (${update.cron})` : 'Removed';
		case 'webhook':
			return update.webhookEnabled ? 'On' : 'Off';
		case 'feedback':
			return describeNaoEventTrigger('feedback', update.eventTriggers ?? {});
		case 'email': {
			const email = update.integrations?.email;
			return email?.enabled ? email.recipients.join(', ') : 'Off';
		}
		case 'slack': {
			const slack = update.integrations?.slack;
			return slack?.enabled ? parseSlackChannels(slack.channelId).join(', ') : 'Off';
		}
	}
}

function formatFieldList(fields: AutomationDraftField[]): string {
	const labels = fields.map((field) => FIELD_LABELS[field]);
	if (labels.length <= 1) {
		return labels[0] ?? 'automation';
	}
	return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
