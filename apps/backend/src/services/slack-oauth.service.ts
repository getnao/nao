import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { DBProjectSlackInstallation, NewProjectSlackInstallation } from '../db/abstractSchema';
import { env } from '../env';
import * as projectSlackInstallationQueries from '../queries/project-slack-installation.queries';
import { claimOnce } from '../utils/keyed-lock';
import { slackService } from './slack';

const SLACK_OAUTH_STATE_TTL_MS = 10 * 60_000;
const SLACK_OAUTH_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_OAUTH_REQUEST_TIMEOUT_MS = 10_000;

export const SLACK_OAUTH_SCOPES = [
	'app_mentions:read',
	'channels:history',
	'channels:join',
	'channels:read',
	'chat:write',
	'chat:write.public',
	'commands',
	'files:write',
	'groups:history',
	'groups:read',
	'im:history',
	'im:read',
	'im:write',
	'mpim:history',
	'mpim:read',
	'reactions:read',
	'reactions:write',
	'users:read',
	'users:read.email',
] as const;

export interface SlackOAuthState {
	projectId: string;
	userId: string;
	nonce: string;
	expiresAt: number;
}

export interface SlackOAuthAccess {
	teamId: string;
	teamName: string;
	enterpriseId: string | null;
	botUserId: string;
	botToken: string;
	scopes: string;
}

export class SlackWorkspaceAlreadyConnectedError extends Error {
	constructor() {
		super('This Slack workspace is already connected to another nao project.');
	}
}

const slackOAuthStateSchema = z.object({
	projectId: z.string().min(1),
	userId: z.string().min(1),
	nonce: z.string().min(1),
	expiresAt: z.number().int(),
});

const slackOAuthAccessResponseSchema = z.discriminatedUnion('ok', [
	z.object({
		ok: z.literal(true),
		access_token: z.string().min(1),
		scope: z.string(),
		bot_user_id: z.string().min(1),
		team: z.object({
			id: z.string().min(1),
			name: z.string().min(1),
		}),
		enterprise: z
			.object({
				id: z.string().min(1),
			})
			.nullable()
			.optional(),
	}),
	z.object({
		ok: z.literal(false),
		error: z.string().min(1),
	}),
]);

const slackUninstallResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});

export async function installSlackWorkspace(
	installation: NewProjectSlackInstallation,
): Promise<DBProjectSlackInstallation> {
	const existingInstallation = await projectSlackInstallationQueries.getSlackInstallationByTeamId(
		installation.teamId,
	);

	if (existingInstallation && existingInstallation.projectId !== installation.projectId) {
		throw new SlackWorkspaceAlreadyConnectedError();
	}

	return projectSlackInstallationQueries.upsertSlackInstallation(installation);
}

export function isSlackOAuthConfigured(): boolean {
	if (
		!env.CLOUD_SLACK_OAUTH_CLIENT_ID ||
		!env.CLOUD_SLACK_OAUTH_CLIENT_SECRET ||
		!env.CLOUD_SLACK_OAUTH_SIGNING_SECRET
	) {
		return false;
	}
	return true;
}

export function buildSlackOAuthAuthorizationUrl(projectId: string, userId: string): string {
	if (!isSlackOAuthConfigured()) {
		throw new Error('Slack OAuth variables are not configured in env');
	}

	const statePayload: SlackOAuthState = {
		projectId,
		userId,
		nonce: randomUUID(),
		expiresAt: Date.now() + SLACK_OAUTH_STATE_TTL_MS,
	};

	const payload = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
	const signature = signSlackOAuthState(payload);
	const state = `${payload}.${signature}`;

	const authorizationUrl = new URL('https://slack.com/oauth/v2/authorize');
	authorizationUrl.searchParams.set('client_id', env.CLOUD_SLACK_OAUTH_CLIENT_ID!);
	authorizationUrl.searchParams.set('scope', SLACK_OAUTH_SCOPES.join(','));
	authorizationUrl.searchParams.set(
		'redirect_uri',
		new URL('/api/slack/oauth/callback', env.BETTER_AUTH_URL).toString(),
	);
	authorizationUrl.searchParams.set('state', state);

	return authorizationUrl.toString();
}

export async function verifySlackOAuthState(state: string, currentUserId: string): Promise<SlackOAuthState> {
	const parts = state.split('.');
	if (parts.length !== 2) {
		throw new Error('Invalid Slack OAuth state');
	}

	const [payload, signature] = parts;
	if (!payload || !signature) {
		throw new Error('Invalid Slack OAuth state');
	}

	const expectedSignature = signSlackOAuthState(payload);
	const signatureBuffer = Buffer.from(signature, 'base64url');
	const expectedSignatureBuffer = Buffer.from(expectedSignature, 'base64url');

	if (
		signatureBuffer.length !== expectedSignatureBuffer.length ||
		!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
	) {
		throw new Error('Invalid Slack OAuth state');
	}

	let statePayload: SlackOAuthState;
	try {
		const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
		statePayload = slackOAuthStateSchema.parse(decodedPayload);
	} catch {
		throw new Error('Invalid Slack OAuth state');
	}

	if (statePayload.expiresAt <= Date.now()) {
		throw new Error('Slack OAuth state has expired');
	}

	if (statePayload.userId !== currentUserId) {
		throw new Error('Slack OAuth state does not match the current user');
	}

	const firstUse = await claimOnce(`slack-oauth-state:${statePayload.nonce}`, statePayload.expiresAt - Date.now());

	if (!firstUse) {
		throw new Error('Slack OAuth state has already been used');
	}

	return statePayload;
}

export async function exchangeSlackOAuthCode(code: string): Promise<SlackOAuthAccess> {
	const clientId = env.CLOUD_SLACK_OAUTH_CLIENT_ID!;
	const clientSecret = env.CLOUD_SLACK_OAUTH_CLIENT_SECRET!;

	if (!clientId || !clientSecret) {
		throw new Error('Slack OAuth variables are not configured in env');
	}

	const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
	const response = await fetch(SLACK_OAUTH_ACCESS_URL, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			code,
			redirect_uri: new URL('/api/slack/oauth/callback', env.BETTER_AUTH_URL).toString(),
		}),
		signal: AbortSignal.timeout(SLACK_OAUTH_REQUEST_TIMEOUT_MS),
	});

	const body = await response.json().catch(() => null);
	const parsedResponse = slackOAuthAccessResponseSchema.safeParse(body);

	if (!response.ok || !parsedResponse.success) {
		throw new Error('Slack returned an invalid OAuth response');
	}

	if (!parsedResponse.data.ok) {
		throw new Error(`Slack OAuth failed: ${parsedResponse.data.error}`);
	}

	return {
		teamId: parsedResponse.data.team.id,
		teamName: parsedResponse.data.team.name,
		enterpriseId: parsedResponse.data.enterprise?.id ?? null,
		botUserId: parsedResponse.data.bot_user_id,
		botToken: parsedResponse.data.access_token,
		scopes: parsedResponse.data.scope,
	};
}

export async function disconnectSlackWorkspace(projectId: string): Promise<void> {
	const installation = await projectSlackInstallationQueries.getSlackInstallationByProjectId(projectId);
	if (!installation) {
		return;
	}
	const clientId = env.CLOUD_SLACK_OAUTH_CLIENT_ID;
	const clientSecret = env.CLOUD_SLACK_OAUTH_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('Slack OAuth is not configured.');
	}
	const response = await fetch('https://slack.com/api/apps.uninstall', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${installation.encryptedBotToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
		}),
		signal: AbortSignal.timeout(SLACK_OAUTH_REQUEST_TIMEOUT_MS),
	});
	const body = await response.json().catch(() => null);
	const parsedResponse = slackUninstallResponseSchema.safeParse(body);
	if (!response.ok || !parsedResponse.success || !parsedResponse.data.ok) {
		throw new Error('Slack app could not be uninstalled.');
	}
	await slackService.stopProject(projectId);
	await projectSlackInstallationQueries.deleteSlackInstallationByProjectId(projectId);
}

function signSlackOAuthState(payload: string): string {
	return createHmac('sha256', env.BETTER_AUTH_SECRET).update(payload).digest('base64url');
}
