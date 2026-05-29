import crypto from 'node:crypto';

import { MCP_EMBED_TOKEN_TTL_MS } from '@nao/shared';
import type { EmbedTokenPayload, McpEmbedKind } from '@nao/shared/types';

import { env } from '../env';
import { getMcpEndpointSettings } from '../queries/mcp-endpoint.queries';
import { HandlerError } from './error';

const SEPARATOR = '.';

export function generateEmbedToken(type: McpEmbedKind, resourceId: string, projectId: string): string {
	const payload: EmbedTokenPayload = { type, resourceId, projectId, exp: Date.now() + MCP_EMBED_TOKEN_TTL_MS };
	const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const sig = crypto.createHmac('sha256', env.BETTER_AUTH_SECRET).update(payloadB64).digest('base64url');
	return `${payloadB64}${SEPARATOR}${sig}`;
}

export function verifyEmbedToken(token: string): EmbedTokenPayload | null {
	const sep = token.lastIndexOf(SEPARATOR);
	if (sep === -1) {
		return null;
	}
	const payloadB64 = token.slice(0, sep);
	const sig = token.slice(sep + 1);
	if (!payloadB64 || !sig) {
		return null;
	}

	const expectedSig = crypto.createHmac('sha256', env.BETTER_AUTH_SECRET).update(payloadB64).digest('base64url');
	try {
		if (!crypto.timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expectedSig, 'base64url'))) {
			return null;
		}
	} catch {
		return null;
	}

	let payload: EmbedTokenPayload;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as EmbedTokenPayload;
	} catch {
		return null;
	}
	if (payload.exp < Date.now()) {
		return null;
	}
	return payload;
}

export async function assertProjectMcpEnabled(projectId: string): Promise<void> {
	const settings = await getMcpEndpointSettings(projectId);
	if (!settings.enabled) {
		throw new HandlerError('FORBIDDEN', 'Embeds are disabled because MCP is turned off for this workspace.');
	}
}
