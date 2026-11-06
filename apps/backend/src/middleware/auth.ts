import type { Session, User } from 'better-auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getSession } from '../auth';
import { DBProject } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import { getUser } from '../queries/user.queries';
import { isApiKey, validateApiKey } from '../services/api-key.service';
import { convertHeaders } from '../utils/utils';

declare module 'fastify' {
	interface FastifyRequest {
		user: User;
		session: Session;
		project: DBProject | null;
	}
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
	const headers = convertHeaders(request.headers);
	const session = await getSession(headers);
	if (!session?.user) {
		return reply.status(401).send({ error: 'Unauthorized' });
	}

	request.user = session.user;
	request.session = session.session;
	request.actorUserId = session.user.id;
	request.project = await projectQueries.getProjectByUserId(session.user.id, headers.get('x-nao-project-id'));
}

/**
 * Also accepts an organization API key (`Authorization: Bearer nao_...`), acting as the key's creator
 * on the organization project named by the `x-nao-project-name` header.
 */
export async function sessionOrApiKeyAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
	const token = getBearerToken(request.headers.authorization);
	if (!token || !isApiKey(token)) {
		return authMiddleware(request, reply);
	}

	const apiKey = await validateApiKey(token);
	const user = apiKey ? await getUser({ id: apiKey.createdBy }) : null;
	if (!apiKey || !user || user.deactivatedAt) {
		return reply.status(401).send({ error: 'Invalid API key' });
	}

	const headers = convertHeaders(request.headers);
	request.user = user;
	request.actorUserId = user.id;
	request.project = await resolveApiKeyProject(apiKey.organization.id, user.id, headers);
}

async function resolveApiKeyProject(orgId: string, userId: string, headers: Headers): Promise<DBProject | null> {
	const projectName = headers.get('x-nao-project-name');
	const namedProject = projectName ? await projectQueries.getProjectByOrgAndName(orgId, projectName) : null;
	if (namedProject) {
		return namedProject;
	}

	const defaultProject = await projectQueries.getProjectByUserId(userId, headers.get('x-nao-project-id'));
	return defaultProject?.orgId === orgId ? defaultProject : null;
}

function getBearerToken(authorization: string | undefined): string | null {
	return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : null;
}
