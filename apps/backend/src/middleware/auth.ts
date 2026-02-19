import type { Session, User } from 'better-auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getAuth } from '../auth';
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
	const auth = await getAuth();
	const session = await auth.api.getSession({ headers });
	if (!session?.user) {
		return reply.status(401).send({ error: 'Unauthorized' });
	}

	request.user = session.user;
	request.session = session.session;
	request.project = await projectQueries.checkUserHasProject(session.user.id);
}
