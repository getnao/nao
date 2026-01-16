import type { Session, User } from 'better-auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { auth } from '../auth';
import { convertHeaders } from '../utils/utils';

declare module 'fastify' {
	interface FastifyRequest {
		user: User;
		session: Session;
	}
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
	const headers = convertHeaders(request.headers);
	const session = await auth.api.getSession({ headers });
	if (!session?.user) {
		return reply.status(401).send({ error: 'Unauthorized' });
	}

	request.user = session.user;
	request.session = session.session;
}
