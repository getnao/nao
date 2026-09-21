import type { Session, User } from 'better-auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getSession } from '../auth';
import { DBProject } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
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
	request.project = await projectQueries.getProjectByUserId(session.user.id, headers.get('x-nao-project-id'));
}
