/**
 * PostHog analytics tracking for nao backend.
 *
 * Tracking is enabled when POSTHOG_DISABLED is not 'true'.
 */
import { getPosthogConfig, PosthogConfig } from '@nao/shared/posthog';
import { PostHog } from 'posthog-node';

import { env } from '../env';
import { getPostHogDistinctId } from '../utils/posthog.utils';

/**
 * All backend PostHog events.
 */
export enum PostHogEvent {
	ServerStarted = 'server_started',
	MessageSent = 'message_sent',
	MessageFeedbackSubmitted = 'message_feedback_submitted',
	SavedPromptCreated = 'saved_prompt_created',
	SavedPromptUpdated = 'saved_prompt_updated',
	SavedPromptDeleted = 'saved_prompt_deleted',
}

/**
 * PostHog analytics service for tracking events.
 */
export class PostHogService {
	private _client: PostHog | undefined = undefined;
	private _config: PosthogConfig = getPosthogConfig(env);
	private _isEnabled: boolean = !env.POSTHOG_DISABLED && env.MODE === 'prod';

	constructor() {}

	/**
	 * Safely capture an event.
	 * If distinctId is not provided, a persistent anonymous distinct ID is generated and used.
	 */
	capture(distinctId: string | undefined, event: PostHogEvent, properties?: Record<string, unknown>): void {
		const posthog = this._getOrCreateClient();
		if (!posthog) {
			return;
		}

		try {
			posthog.capture({
				distinctId: distinctId ?? getPostHogDistinctId(),
				event,
				properties,
			});
		} catch {
			// Tracking should never break the backend
		}
	}

	/**
	 * Shutdown PostHog client and flush pending events.
	 */
	async shutdown(): Promise<void> {
		if (this._client) {
			try {
				await this._client.shutdown();
			} catch {
				// Ignore shutdown errors
			} finally {
				this._client = undefined;
			}
		}
	}

	/**
	 * Initialize PostHog client if enabled and configured.
	 */
	private _getOrCreateClient(): PostHog | undefined {
		if (this._client) {
			return this._client;
		}

		if (!this._isEnabled) {
			return undefined;
		}

		try {
			this._client = new PostHog(this._config.key, {
				host: this._config.host,
			});
		} catch {
			// Silently fail - tracking should never break the backend
		}

		return this._client;
	}

	getConfig(): PosthogConfig & { isEnabled: boolean } {
		return {
			...this._config,
			isEnabled: this._isEnabled,
		};
	}
}

/** Singleton instance of PostHogService */
export const posthog = new PostHogService();
