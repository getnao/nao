import type { Tool } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listShareableMembers: vi.fn(),
	getDisplaySettings: vi.fn(),
	sendEmail: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/services/custom-story', () => ({ getActiveThemeForProject: vi.fn(async () => null) }));
vi.mock('../../src/services/project-sharing.service', () => ({ listShareableMembers: mocks.listShareableMembers }));
vi.mock('../../src/queries/project.queries', () => ({ getDisplaySettings: mocks.getDisplaySettings }));
vi.mock('../../src/services/email', () => ({
	emailService: { isEnabled: () => true, sendEmail: mocks.sendEmail },
}));

import { createAutomationTools } from '../../src/services/automation-tools';
import { createToolContext, executeTool } from '../helpers/tool-context';

type EmailInput = { recipients: string[]; text: string };
type EmailOutput = { ok: boolean; recipients: string[] };

const OWNER_ID = 'owner-1';
const MEMBER = { id: 'member-1', name: 'Ada', email: 'Ada@example.com' };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.listShareableMembers.mockResolvedValue([MEMBER]);
	mocks.getDisplaySettings.mockResolvedValue({ dateFormat: null });
});

describe('send_automation_email', () => {
	it('sends to the members the automation owner can share with, whatever the address case', async () => {
		const result = await sendEmail({ configured: ['ada@example.com'], requested: [] });

		expect(result.recipients).toEqual(['ada@example.com']);
		expect(mocks.listShareableMembers).toHaveBeenCalledWith('project-1', OWNER_ID);
		expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ source: 'saved on the automation', configured: ['outsider@example.com'], requested: [] },
		{ source: 'added by the agent', configured: ['ada@example.com'], requested: ['outsider@example.com'] },
	])('sends nothing when a recipient $source is not such a member', async ({ configured, requested }) => {
		await expect(sendEmail({ configured, requested })).rejects.toThrow('outsider@example.com');

		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});

	it('rejects a member removed while the report was rendering', async () => {
		mocks.getDisplaySettings.mockImplementation(async () => {
			mocks.listShareableMembers.mockResolvedValue([]);
			return { dateFormat: null };
		});

		await expect(sendEmail({ configured: ['ada@example.com'], requested: [] })).rejects.toThrow('ada@example.com');

		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});
});

function sendEmail({ configured, requested }: { configured: string[]; requested: string[] }): Promise<EmailOutput> {
	const tool = createAutomationTools({
		projectId: 'project-1',
		chatId: 'chat-1',
		githubToken: null,
		integrations: { email: { enabled: true, recipients: configured } },
	}).send_automation_email as Tool<EmailInput, EmailOutput>;
	return executeTool(tool, { recipients: requested, text: 'Report' }, createToolContext({ userId: OWNER_ID }));
}
