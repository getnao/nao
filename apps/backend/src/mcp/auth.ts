import { getAuth } from '../auth';
import { convertHeaders } from '../utils/utils';

export async function resolveUserId(fastifyRequest: {
	headers: Record<string, string | string[] | undefined>;
	url: string;
}): Promise<string | null> {
	const auth = await getAuth();
	const headers = convertHeaders(fastifyRequest.headers);

	const session = await auth.api.getSession({ headers });
	if (session?.user) {
		return session.user.id;
	}

	const host = fastifyRequest.headers['host'] ?? 'localhost';
	const request = new Request(`http://${host}${fastifyRequest.url}`, { headers });
	const mcpSession = await auth.api.getMcpSession({ headers, request, asResponse: false });
	if (mcpSession?.userId) {
		return mcpSession.userId;
	}

	return null;
}
