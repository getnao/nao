import { describe, expect, it } from 'vitest';

import type { AutomationDraft } from '../src/automation-draft';
import { applyAutomationDraftUpdate, listAutomationDraftUpdateFields } from '../src/automation-draft';

const DRAFT: AutomationDraft = {
	title: 'Weekly revenue',
	prompt: 'Summarize last week revenue.',
	cron: '0 9 * * 1',
	scheduleDescription: 'Every Monday at 9am',
	webhookEnabled: false,
	mcpEnabled: false,
	integrations: {
		email: { enabled: true, recipients: ['me@example.com'] },
		github: { enabled: true, repositories: ['org/repo'] },
	},
};

describe('applyAutomationDraftUpdate', () => {
	it('replaces the changed fields and keeps the others', () => {
		const next = applyAutomationDraftUpdate(DRAFT, { title: 'Daily revenue', cron: '0 9 * * *' });

		expect(next).toEqual({ ...DRAFT, title: 'Daily revenue', cron: '0 9 * * *' });
	});

	it('replaces a delivery integration without touching the others', () => {
		const next = applyAutomationDraftUpdate(DRAFT, {
			integrations: { slack: { enabled: true, channelId: '#sales' } },
		});

		expect(next.integrations).toEqual({ ...DRAFT.integrations, slack: { enabled: true, channelId: '#sales' } });
	});

	it('keeps the fields of the form the draft came from', () => {
		const formValue = { ...DRAFT, enabled: false };

		expect(applyAutomationDraftUpdate(formValue, { webhookEnabled: true })).toEqual({
			...formValue,
			webhookEnabled: true,
		});
	});
});

describe('listAutomationDraftUpdateFields', () => {
	it('names every changed part of the automation once', () => {
		expect(
			listAutomationDraftUpdateFields({
				title: 'Daily revenue',
				prompt: 'Summarize yesterday.',
				cron: '',
				scheduleDescription: '',
				webhookEnabled: true,
				integrations: { email: { enabled: false, recipients: [] }, slack: { enabled: false, channelId: '' } },
			}),
		).toEqual(['title', 'prompt', 'schedule', 'webhook', 'email', 'slack']);
	});

	it('names nothing for an empty update', () => {
		expect(listAutomationDraftUpdateFields({ integrations: {} })).toEqual([]);
	});
});
