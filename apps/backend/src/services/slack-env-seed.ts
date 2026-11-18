import { env } from '../env';
import { getDefaultProject } from '../queries/project.queries';
import { applySlackTransportSettings } from '../queries/project-slack-config.queries';
import type { SlackTransportMode } from '../types/messaging-provider';
import { logger } from '../utils/logger';

/**
 * Seed the default project's Slack settings from SLACK_* env vars on boot, so a deployment can
 * declare its Slack integration instead of pasting tokens into Settings > Slack. The seed only
 * writes when the settings are absent or were written by a previous seed — a config saved through
 * the UI is never overwritten, so deployments that already export SLACK_* for nao_config.yaml
 * templating keep their existing setup on upgrade. UI-managed fields (model selection, reply mode,
 * auto-created users) are preserved either way. Never throws — Slack must not block startup.
 */
export async function seedSlackConfigFromEnv(): Promise<boolean> {
	if (!env.SLACK_BOT_TOKEN) {
		return false;
	}

	try {
		const project = await getDefaultProject();
		if (!project) {
			logger.warn('SLACK_BOT_TOKEN is set but no project exists yet; Slack env seed skipped', {
				source: 'system',
			});
			return false;
		}

		const settings = project.slackSettings;
		if (settings && settings.slackSettingsSource !== 'env') {
			logger.info(
				'SLACK_* env vars are set but the Slack settings were saved through the UI; leaving them untouched (delete them in Settings > Slack to hand ownership to the environment)',
				{ source: 'system', context: { projectId: project.id } },
			);
			return false;
		}

		const transportMode = envSlackTransportMode();
		if (matchesEnv(settings, transportMode)) {
			return false;
		}

		await applySlackTransportSettings({
			projectId: project.id,
			botToken: env.SLACK_BOT_TOKEN,
			signingSecret: env.SLACK_SIGNING_SECRET ?? '',
			transportMode,
			appToken: env.SLACK_APP_TOKEN ?? '',
		});
		logger.info(`Slack settings seeded from environment for project ${project.id} (${transportMode} mode)`, {
			source: 'system',
			context: { projectId: project.id },
		});
		return true;
	} catch (error) {
		logger.error(`Failed to seed Slack settings from environment: ${String(error)}`, { source: 'system' });
		return false;
	}
}

/** Explicit override, else inferred from which secret is present: an app token means Socket Mode. */
function envSlackTransportMode(): SlackTransportMode {
	return env.SLACK_TRANSPORT_MODE ?? (env.SLACK_APP_TOKEN ? 'socket' : 'webhook');
}

type StoredSlackSettings = {
	slackBotToken?: string;
	slackSigningSecret?: string;
	slackAppToken?: string;
	slackTransportMode?: string;
	slackSettingsSource?: string;
} | null;

function matchesEnv(settings: StoredSlackSettings, transportMode: SlackTransportMode): boolean {
	return (
		!!settings &&
		settings.slackBotToken === env.SLACK_BOT_TOKEN &&
		(settings.slackSigningSecret ?? '') === (env.SLACK_SIGNING_SECRET ?? '') &&
		(settings.slackAppToken ?? '') === (env.SLACK_APP_TOKEN ?? '') &&
		settings.slackTransportMode === transportMode
	);
}
