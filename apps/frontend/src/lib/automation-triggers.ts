import { NAO_EVENT_TYPES } from '@nao/shared/types';
import type { AutomationEventTriggers, AutomationFeedbackTrigger, NaoEventType } from '@nao/shared/types';

type AutomationTriggers = {
	cron: string;
	enabled: boolean;
	scheduleDescription?: string | null;
	webhookEnabled: boolean;
	eventTriggers: AutomationEventTriggers;
};

export const NAO_EVENT_LABELS: Record<NaoEventType, string> = {
	feedback: 'Feedback',
};

/** Scheduled automations are switched on and off by their schedule; others by their webhook and nao events. */
export function isAutomationActive(automation: AutomationTriggers): boolean {
	return automation.cron ? automation.enabled : automation.webhookEnabled || hasNaoEventTrigger(automation);
}

export function hasNaoEventTrigger(automation: Pick<AutomationTriggers, 'eventTriggers'>): boolean {
	return getEnabledNaoEvents(automation.eventTriggers).length > 0;
}

export function getEnabledNaoEvents(eventTriggers: AutomationEventTriggers): NaoEventType[] {
	return NAO_EVENT_TYPES.filter((eventType) => eventTriggers[eventType]?.enabled);
}

/**
 * Surfaces every configured trigger so a paused schedule is not mistaken for the automation having
 * no other trigger. A paused schedule stops all triggers, including the webhook and nao events.
 */
export function getAutomationTriggerLabel(automation: AutomationTriggers): string {
	const eventTriggers = getEventTriggerNames(automation);
	if (automation.cron) {
		return [automation.scheduleDescription || automation.cron, ...eventTriggers].join(' · ');
	}
	if (eventTriggers.length === 0) {
		return 'No active trigger';
	}
	return `Triggered by ${eventTriggers.join(' & ')}`;
}

export function describeNaoEventTrigger(eventType: NaoEventType, eventTriggers: AutomationEventTriggers): string {
	const trigger = eventTriggers[eventType];
	if (!trigger?.enabled) {
		return 'Disabled';
	}
	return describeFeedbackTrigger(trigger);
}

function describeFeedbackTrigger(trigger: AutomationFeedbackTrigger): string {
	return `${describeFeedbackVotes(trigger)} on ${describeFeedbackSources(trigger)}`;
}

function getEventTriggerNames(automation: AutomationTriggers): string[] {
	const webhook = automation.webhookEnabled ? ['webhook'] : [];
	const naoEvents = getEnabledNaoEvents(automation.eventTriggers).map((eventType) =>
		NAO_EVENT_LABELS[eventType].toLowerCase(),
	);
	return [...webhook, ...naoEvents];
}

function describeFeedbackVotes({ votes }: AutomationFeedbackTrigger): string {
	if (votes.length > 1) {
		return 'Any vote';
	}
	return votes[0] === 'up' ? 'Thumbs up' : 'Thumbs down';
}

function describeFeedbackSources({ sources }: AutomationFeedbackTrigger): string {
	if (sources.length > 1) {
		return 'chats & stories';
	}
	return sources[0] === 'chat' ? 'chats' : 'stories';
}
