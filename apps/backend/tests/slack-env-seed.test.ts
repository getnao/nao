import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	project: null as Record<string, unknown> | null,
	applySlackTransportSettings: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/queries/project.queries', () => ({
	getDefaultProject: vi.fn(async () => testState.project),
}));

vi.mock('../src/queries/project-slack-config.queries', () => ({
	applySlackTransportSettings: testState.applySlackTransportSettings,
}));

import { __reloadEnvForTesting } from '../src/env';
import { seedSlackConfigFromEnv } from '../src/services/slack-env-seed';

describe('seedSlackConfigFromEnv', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		testState.project = { id: 'project-1', slackSettings: null };
		testState.applySlackTransportSettings.mockReset();
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	function setSlackEnv(vars: Record<string, string | undefined>) {
		for (const key of ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN', 'SLACK_TRANSPORT_MODE']) {
			delete process.env[key];
		}
		for (const [key, value] of Object.entries(vars)) {
			if (value !== undefined) {
				process.env[key] = value;
			}
		}
		__reloadEnvForTesting();
	}

	it('does nothing when SLACK_BOT_TOKEN is unset', async () => {
		setSlackEnv({});
		expect(await seedSlackConfigFromEnv()).toBe(false);
		expect(testState.applySlackTransportSettings).not.toHaveBeenCalled();
	});

	it('seeds socket mode when an app token is present', async () => {
		setSlackEnv({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_APP_TOKEN: 'xapp-1' });
		expect(await seedSlackConfigFromEnv()).toBe(true);
		expect(testState.applySlackTransportSettings).toHaveBeenCalledWith({
			projectId: 'project-1',
			botToken: 'xoxb-1',
			signingSecret: '',
			transportMode: 'socket',
			appToken: 'xapp-1',
		});
	});

	it('never overwrites settings that were saved through the UI', async () => {
		testState.project = {
			id: 'project-1',
			slackSettings: {
				slackBotToken: 'xoxb-ui',
				slackSigningSecret: 'sig-ui',
				slackAppToken: 'xapp-ui',
				slackTransportMode: 'socket',
			},
		};
		setSlackEnv({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_SIGNING_SECRET: 'sig-1' });
		expect(await seedSlackConfigFromEnv()).toBe(false);
		expect(testState.applySlackTransportSettings).not.toHaveBeenCalled();
	});

	it('updates settings that a previous seed wrote', async () => {
		testState.project = {
			id: 'project-1',
			slackSettings: {
				slackBotToken: 'xoxb-old',
				slackSigningSecret: '',
				slackAppToken: 'xapp-old',
				slackTransportMode: 'socket',
				slackSettingsSource: 'env',
			},
		};
		setSlackEnv({ SLACK_BOT_TOKEN: 'xoxb-new', SLACK_APP_TOKEN: 'xapp-new' });
		expect(await seedSlackConfigFromEnv()).toBe(true);
		expect(testState.applySlackTransportSettings).toHaveBeenCalledWith(
			expect.objectContaining({ botToken: 'xoxb-new', appToken: 'xapp-new' }),
		);
	});

	it('seeds webhook mode when only a signing secret is present', async () => {
		setSlackEnv({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_SIGNING_SECRET: 'sig-1' });
		expect(await seedSlackConfigFromEnv()).toBe(true);
		expect(testState.applySlackTransportSettings).toHaveBeenCalledWith({
			projectId: 'project-1',
			botToken: 'xoxb-1',
			signingSecret: 'sig-1',
			transportMode: 'webhook',
			appToken: '',
		});
	});

	it('honours an explicit transport override', async () => {
		setSlackEnv({
			SLACK_BOT_TOKEN: 'xoxb-1',
			SLACK_SIGNING_SECRET: 'sig-1',
			SLACK_APP_TOKEN: 'xapp-1',
			SLACK_TRANSPORT_MODE: 'webhook',
		});
		expect(await seedSlackConfigFromEnv()).toBe(true);
		expect(testState.applySlackTransportSettings).toHaveBeenCalledWith(
			expect.objectContaining({ transportMode: 'webhook' }),
		);
	});

	it('skips the write when the stored settings already match the environment', async () => {
		testState.project = {
			id: 'project-1',
			slackSettings: {
				slackBotToken: 'xoxb-1',
				slackSigningSecret: '',
				slackAppToken: 'xapp-1',
				slackTransportMode: 'socket',
				slackSettingsSource: 'env',
			},
		};
		setSlackEnv({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_APP_TOKEN: 'xapp-1' });
		expect(await seedSlackConfigFromEnv()).toBe(false);
		expect(testState.applySlackTransportSettings).not.toHaveBeenCalled();
	});

	it('skips gracefully when no project exists yet', async () => {
		testState.project = null;
		setSlackEnv({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_APP_TOKEN: 'xapp-1' });
		expect(await seedSlackConfigFromEnv()).toBe(false);
		expect(testState.applySlackTransportSettings).not.toHaveBeenCalled();
	});

	it('rejects socket mode without an app token at env parse time', () => {
		process.env.SLACK_BOT_TOKEN = 'xoxb-1';
		process.env.SLACK_TRANSPORT_MODE = 'socket';
		delete process.env.SLACK_APP_TOKEN;
		expect(() => __reloadEnvForTesting()).toThrow(/SLACK_APP_TOKEN/);
	});

	it('rejects webhook mode without a signing secret at env parse time', () => {
		process.env.SLACK_BOT_TOKEN = 'xoxb-1';
		delete process.env.SLACK_SIGNING_SECRET;
		delete process.env.SLACK_APP_TOKEN;
		expect(() => __reloadEnvForTesting()).toThrow(/SLACK_SIGNING_SECRET/);
	});

	it('rejects SLACK_* extras without the bot token at env parse time', () => {
		delete process.env.SLACK_BOT_TOKEN;
		process.env.SLACK_APP_TOKEN = 'xapp-1';
		expect(() => __reloadEnvForTesting()).toThrow(/SLACK_BOT_TOKEN/);
		delete process.env.SLACK_APP_TOKEN;
		process.env.SLACK_SIGNING_SECRET = 'sig-1';
		expect(() => __reloadEnvForTesting()).toThrow(/SLACK_BOT_TOKEN/);
	});
});
