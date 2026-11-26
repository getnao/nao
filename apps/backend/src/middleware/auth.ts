import type { Session, User } from 'better-auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getSession } from '../auth';
import { DBProject } from '../db/abstractSchema';
import { isCloud } from '../env';
import * as projectQueries from '../queries/project.queries';
import { isApiKey, validateApiKey } from '../services/api-key.service';
import { isSelfHostedMultiProjectEnabled } from '../services/multi-project.service';
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
	if (session.twoFactorSetupRequired) {
		return reply.status(403).send({ error: 'Set up two-factor authentication to continue.' });
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
	if (!apiKey) {
		return reply.status(401).send({ error: 'Invalid API key' });
	}
	const user = apiKey.creator;

	const headers = convertHeaders(request.headers);
	const orgId = apiKey.organization.id;
	const projectName = headers.get('x-nao-project-name');
	const namedProject = projectName ? await projectQueries.getProjectByOrgAndName(orgId, projectName) : null;
	if (projectName && !namedProject && (await servesSeveralProjects())) {
		return reply.status(400).send({
			error: `Project "${projectName}" does not exist in this organization. Deploy it first, or make project_name in nao_config.yaml match its name.`,
		});
	}

	request.user = user;
	request.actorUserId = user.id;
	request.project = namedProject ?? (await getDefaultProjectOfOrganization(orgId, user.id, headers));
}

/** An instance serving one project runs it whatever name the client gives; with several, a name must match. */
async function servesSeveralProjects(): Promise<boolean> {
	return isCloud || (await isSelfHostedMultiProjectEnabled());
}

async function getDefaultProjectOfOrganization(
	orgId: string,
	userId: string,
	headers: Headers,
): Promise<DBProject | null> {
	const defaultProject = await projectQueries.getProjectByUserId(userId, headers.get('x-nao-project-id'));
	return defaultProject?.orgId === orgId ? defaultProject : null;
}

function getBearerToken(authorization: string | undefined): string | null {
	return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : null;
}
