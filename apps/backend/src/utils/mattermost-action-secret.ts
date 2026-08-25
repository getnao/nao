import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env';

export function createMattermostActionSecret(projectId: string): string {
	return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`mattermost:${projectId}`).digest('base64url');
}

export function verifyMattermostActionSecret(projectId: string, candidate: unknown): boolean {
	if (typeof candidate !== 'string') {
		return false;
	}
	const expected = createMattermostActionSecret(projectId);
	const expectedBuffer = Buffer.from(expected);
	const candidateBuffer = Buffer.from(candidate);
	return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}
