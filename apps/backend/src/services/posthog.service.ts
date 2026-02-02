/**
 * PostHog analytics tracking for nao backend.
 *
 * Tracking is enabled when POSTHOG_DISABLED is not 'true' AND both POSTHOG_KEY and POSTHOG_HOST are configured.
 */
import { PostHog } from 'posthog-node';

import { getPostHogDistinctId } from '../utils/posthog.utils';

/**
 * All backend PostHog events.
 */
export enum PostHogEvent {
	ServerStarted = 'server_started',
	MessageSent = 'message_sent',
	MessageFeedbackSubmitted = 'message_feedback_submitted',
}

/**
 * PostHog analytics service for tracking events.
 */
export class PostHogService {
	private _client: PostHog | undefined = undefined;
	private readonly _enabled: boolean;
	private readonly _key: string | undefined;
	private readonly _host: string | undefined;

	constructor() {
		const disabled = process.env.POSTHOG_DISABLED?.toLowerCase() === 'true';
		this._key = process.env.POSTHOG_KEY;
		this._host = process.env.POSTHOG_HOST;
		this._enabled = !disabled && !!this._key && !!this._host;
	}

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

		if (!this._enabled) {
			return undefined;
		}

		try {
			this._client = new PostHog(this._key!, {
				host: this._host,
			});
		} catch {
			// Silently fail - tracking should never break the backend
		}

		return this._client;
	}
}

/** Singleton instance of PostHogService */
export const posthog = new PostHogService();
