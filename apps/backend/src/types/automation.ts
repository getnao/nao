export const AUTOMATION_RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;

export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

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

export const AUTOMATION_EMAIL_RECIPIENT_POLICIES = ['project-members', 'allowed-domains', 'anyone'] as const;

export type AutomationEmailRecipientPolicy = (typeof AUTOMATION_EMAIL_RECIPIENT_POLICIES)[number];

export type AutomationEmailSettings = {
	recipientPolicy: AutomationEmailRecipientPolicy;
	allowedDomains: string[];
};
