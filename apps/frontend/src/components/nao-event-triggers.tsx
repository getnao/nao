import { ThumbsUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AutomationEventTriggers, NaoEventType } from '@nao/shared/types';
import { buildDefaultFeedbackTrigger, FeedbackTriggerRow } from '@/components/automation-feedback-trigger-row';
import NaoLogo from '@/components/icons/nao-logo.svg';
import {
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { NAO_EVENT_LABELS } from '@/lib/automation-triggers';

type NaoEventTriggerOption = {
	type: NaoEventType;
	Icon: LucideIcon;
};

const NAO_EVENT_TRIGGER_OPTIONS: NaoEventTriggerOption[] = [{ type: 'feedback', Icon: ThumbsUp }];

type NaoEventTriggerContext = {
	canUseChatFeedback: boolean;
};

export function NaoEventsSubmenu({
	eventTriggers,
	onAdd,
}: {
	eventTriggers: AutomationEventTriggers;
	onAdd: (eventType: NaoEventType) => void;
}) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<NaoEventsIcon />
				<span>nao Events</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent sideOffset={6} alignOffset={-5} className='w-auto min-w-36'>
				{NAO_EVENT_TRIGGER_OPTIONS.map((option) => {
					const isAdded = Boolean(eventTriggers[option.type]?.enabled);
					return (
						<DropdownMenuItem key={option.type} onSelect={() => onAdd(option.type)} disabled={isAdded}>
							<option.Icon className='size-4' />
							<span>{NAO_EVENT_LABELS[option.type]}</span>
							{isAdded && <span className='ml-auto text-xs text-muted-foreground'>Added</span>}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

/** The nao logo is wider than tall, so it is drawn at the optical width of the lucide icons beside it. */
function NaoEventsIcon() {
	return (
		<span className='inline-flex size-4 shrink-0 items-center justify-center'>
			<NaoLogo className='size-[13px]' />
		</span>
	);
}

export function NaoEventTriggerRows({
	eventTriggers,
	context,
	onChange,
	disabled,
}: {
	eventTriggers: AutomationEventTriggers;
	context: NaoEventTriggerContext;
	onChange: (eventTriggers: AutomationEventTriggers) => void;
	disabled: boolean;
}) {
	const { feedback } = eventTriggers;
	if (!feedback?.enabled) {
		return null;
	}
	return (
		<FeedbackTriggerRow
			trigger={feedback}
			canUseChatSource={context.canUseChatFeedback}
			onChange={(trigger) => onChange({ ...eventTriggers, feedback: trigger })}
			onRemove={() => onChange(removeNaoEventTrigger(eventTriggers, 'feedback'))}
			disabled={disabled}
		/>
	);
}

export function canAddNaoEventTrigger(eventTriggers: AutomationEventTriggers): boolean {
	return NAO_EVENT_TRIGGER_OPTIONS.some((option) => !eventTriggers[option.type]?.enabled);
}

/** Re-enables a paused event trigger with its previous settings, or adds it with defaults. */
export function addNaoEventTrigger(
	eventTriggers: AutomationEventTriggers,
	eventType: NaoEventType,
	context: NaoEventTriggerContext,
): AutomationEventTriggers {
	const existing = eventTriggers[eventType];
	const trigger = existing ? { ...existing, enabled: true } : buildDefaultFeedbackTrigger(context.canUseChatFeedback);
	return { ...eventTriggers, [eventType]: trigger };
}

function removeNaoEventTrigger(
	eventTriggers: AutomationEventTriggers,
	eventType: NaoEventType,
): AutomationEventTriggers {
	const { [eventType]: _removed, ...remaining } = eventTriggers;
	return remaining;
}
