import type { FeedbackVote } from '@nao/shared/types';

export const AUTOMATION_RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;

export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/** What started an automation run. Runs from before triggers were recorded have none. */
export const AUTOMATION_RUN_TRIGGERS = ['schedule', 'manual', 'webhook', 'feedback'] as const;

export type AutomationRunTrigger = (typeof AUTOMATION_RUN_TRIGGERS)[number];

export type AutomationIntegrationConfig = {
	email?: {
		enabled: boolean;
		recipients: string[];
		subject?: string;
	};
	slack?: {
		enabled: boolean;
		channelId: string;
	};
	github?: {
		enabled: boolean;
		repositories: string[];
		actions?: {
			createIssue?: boolean;
			createPullRequest?: boolean;
			addComment?: boolean;
		};
	};
};

export type AutomationIntegrationResult = {
	type: 'email' | 'slack' | 'github';
	label: string;
	ok: boolean;
	message?: string;
	url?: string;
	destination?: string;
};

type FeedbackTriggerEventBase = {
	kind: 'feedback';
	vote: FeedbackVote;
	explanation: string | null;
	submitter: { name: string; email: string };
	url: string;
};

export type ChatFeedbackTriggerEvent = FeedbackTriggerEventBase & {
	source: 'chat';
	chatTitle: string | null;
	question: string | null;
	answer: string | null;
};

export type StoryFeedbackTriggerEvent = FeedbackTriggerEventBase & {
	source: 'story';
	storyTitle: string;
};

export type FeedbackTriggerEvent = ChatFeedbackTriggerEvent | StoryFeedbackTriggerEvent;

/** The event that started an automation run, when it was not a schedule, webhook or manual run. */
export type AutomationTriggerEvent = FeedbackTriggerEvent;
