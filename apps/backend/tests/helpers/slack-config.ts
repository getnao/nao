import type { SlackConfig } from '../../src/queries/project-slack-config.queries';

export function createSlackConfig(overrides: Partial<SlackConfig> = {}): SlackConfig {
	return {
		projectId: 'project-1',
		botToken: 'xoxb-test',
		signingSecret: 'secret',
		redirectUrl: 'https://nao.example.com/',
		autoCreateUsersEnabled: false,
		autoCreateUsersDomains: [],
		transportMode: 'webhook',
		appToken: '',
		replyMode: 'thread',
		dmScopeMissing: false,
		...overrides,
	};
}
