import { createHmac } from 'node:crypto';

import { SocketModeClient } from '@slack/socket-mode';
import { Chat } from 'chat';

import { logger } from '../utils/logger';

type SlackWebhooks = NonNullable<Chat['webhooks']>;

const SLACK_SOCKET_ACK_TIMEOUT_MS = 2500;
const SLACK_SOCKET_ACK_TIMEOUT = Symbol('slack-socket-ack-timeout');

export interface SlackSocketBridgeOptions {
	projectId: string;
	appToken: string;
	signingSecret: string;
	webhooks: SlackWebhooks;
}

interface SlackSocketEvent {
	envelope_id: string;
	type: string;
	body: Record<string, unknown>;
	event?: { type?: string };
	accepts_response_payload?: boolean;
	retry_num?: number;
	retry_reason?: string;
	ack: (response?: unknown) => Promise<void>;
}

/**
 * Bridges Slack Socket Mode events into the existing webhook adapter pipeline.
 *
 * The chat-adapter's `webhooks.slack(...)` is HTTP-shaped and verifies a Slack
 * signature. In Socket Mode we receive already-authenticated events from
 * Slack, so we re-sign each forwarded request with the adapter's signing
 * secret to satisfy the signature check.
 *
 * For events that accept a response payload (slash commands, interactive
 * components such as view submissions), the webhook response body is
 * forwarded to `ack()` so payloads like modal validation errors and view
 * updates reach Slack instead of being dropped.
 */
export class SlackSocketBridge {
	private readonly _projectId: string;
	private readonly _client: SocketModeClient;
	private readonly _webhooks: SlackWebhooks;
	private readonly _signingSecret: string;
	private _started: boolean = false;

	constructor(options: SlackSocketBridgeOptions) {
		this._projectId = options.projectId;
		this._webhooks = options.webhooks;
		this._signingSecret = options.signingSecret;
		this._client = new SocketModeClient({
			appToken: options.appToken,
			autoReconnectEnabled: true,
		});
		this._client.on('slack_event', (event: SlackSocketEvent) => {
			void this._handleEvent(event);
		});
		this._client.on('error', (err: unknown) => {
			logger.error(`Slack socket mode error (project ${this._projectId}): ${String(err)}`, {
				source: 'system',
				context: { projectId: this._projectId },
			});
		});
	}

	public async start(): Promise<void> {
		if (this._started) {
			return;
		}
		this._started = true;
		try {
			await this._client.start();
			logger.info(`Slack socket mode started for project ${this._projectId}`, {
				source: 'system',
				context: { projectId: this._projectId },
			});
		} catch (error) {
			this._started = false;
			throw error;
		}
	}

	public async stop(): Promise<void> {
		if (!this._started) {
			return;
		}
		this._started = false;
		try {
			await this._client.disconnect();
		} catch (error) {
			logger.warn(`Failed to stop Slack socket client for project ${this._projectId}: ${String(error)}`, {
				source: 'system',
				context: { projectId: this._projectId },
			});
		}
	}

	private async _handleEvent(event: SlackSocketEvent): Promise<void> {
		if (!event.accepts_response_payload) {
			await this._safeAck(event);
			await this._dispatchToWebhook(event);
			return;
		}

		const payloadPromise = this._dispatchToAckPayload(event);
		const payload = await this._getAckPayloadBeforeDeadline(event, payloadPromise);
		await this._safeAck(event, payload);
	}

	private async _dispatchToWebhook(event: SlackSocketEvent): Promise<Response | null> {
		try {
			const request = this._buildHttpRequest(event);
			return await this._webhooks.slack(request, {
				waitUntil: (task: Promise<unknown>) => task,
			});
		} catch (error) {
			logger.error(`Slack socket event dispatch failed for project ${this._projectId}: ${String(error)}`, {
				source: 'system',
				context: { projectId: this._projectId },
			});
			return null;
		}
	}

	private async _dispatchToAckPayload(event: SlackSocketEvent): Promise<unknown> {
		const response = await this._dispatchToWebhook(event);
		return response ? this._buildAckPayload(event, response) : undefined;
	}

	private async _getAckPayloadBeforeDeadline(
		event: SlackSocketEvent,
		payloadPromise: Promise<unknown>,
	): Promise<unknown> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<typeof SLACK_SOCKET_ACK_TIMEOUT>((resolve) => {
			timeoutId = setTimeout(() => resolve(SLACK_SOCKET_ACK_TIMEOUT), SLACK_SOCKET_ACK_TIMEOUT_MS);
		});

		const result = await Promise.race([payloadPromise, timeoutPromise]);
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (result === SLACK_SOCKET_ACK_TIMEOUT) {
			logger.warn(`Slack socket ack payload timed out for project ${this._projectId}; acking without payload`, {
				source: 'system',
				context: { projectId: this._projectId, envelopeId: event.envelope_id, eventType: event.type },
			});
			return undefined;
		}
		return result;
	}

	private async _buildAckPayload(event: SlackSocketEvent, response: Response): Promise<unknown> {
		const body = await response.text().catch(() => '');
		if (!response.ok) {
			logger.warn(
				`Slack socket forwarded event returned ${response.status} for project ${this._projectId}: ${body}`,
				{
					source: 'system',
					context: { projectId: this._projectId },
				},
			);
			return undefined;
		}
		if (!event.accepts_response_payload || !body) {
			return undefined;
		}
		try {
			return JSON.parse(body);
		} catch {
			return body;
		}
	}

	private async _safeAck(event: SlackSocketEvent, payload?: unknown): Promise<void> {
		try {
			await event.ack(payload);
		} catch (error) {
			logger.warn(`Failed to ack Slack socket event for project ${this._projectId}: ${String(error)}`, {
				source: 'system',
				context: { projectId: this._projectId },
			});
		}
	}

	private _buildHttpRequest(event: SlackSocketEvent): Request {
		const isInteractive = event.type !== 'events_api' && event.type !== 'slash_commands';
		const isSlashCommand = event.type === 'slash_commands';

		let body: string;
		let contentType: string;
		if (isInteractive) {
			body = `payload=${encodeURIComponent(JSON.stringify(event.body))}`;
			contentType = 'application/x-www-form-urlencoded';
		} else if (isSlashCommand) {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(event.body)) {
				if (typeof value === 'string') {
					params.set(key, value);
				}
			}
			body = params.toString();
			contentType = 'application/x-www-form-urlencoded';
		} else {
			body = JSON.stringify(event.body);
			contentType = 'application/json';
		}

		const timestamp = Math.floor(Date.now() / 1000).toString();
		const signature = signSlackRequest(this._signingSecret, timestamp, body);

		return new Request('http://localhost/api/webhooks/slack', {
			method: 'POST',
			headers: {
				'content-type': contentType,
				'x-slack-request-timestamp': timestamp,
				'x-slack-signature': signature,
			},
			body,
		});
	}
}

function signSlackRequest(signingSecret: string, timestamp: string, body: string): string {
	const baseString = `v0:${timestamp}:${body}`;
	const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
	return `v0=${hmac}`;
}
