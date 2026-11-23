import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { bearer } from 'better-auth/plugins/bearer';
import { describe, expect, it } from 'vitest';

import { sessionRotation } from '../../src/services/session-rotation-auth.service';

const BASE_URL = 'http://localhost:5005';

describe('sessionRotation', () => {
	it('issues a new token, revokes the previous one and keeps the session lifetime', async () => {
		const auth = createAuth();
		const previous = await signUp(auth);

		const response = await auth.handler(
			new Request(`${BASE_URL}/api/auth/rotate-session`, {
				method: 'POST',
				headers: { authorization: `Bearer ${previous.token}` },
			}),
		);
		const { token } = (await response.json()) as { token: string };

		expect(response.status).toBe(200);
		expect(token).not.toBe(previous.token);
		expect(response.headers.get('set-cookie')).toContain(token);
		expect(await getSession(auth, previous.token)).toBeNull();

		const rotated = await getSession(auth, token);
		expect(rotated?.user.id).toBe(previous.userId);
		expect(rotated?.session.createdAt).toEqual(previous.createdAt);
		expect(rotated?.session.expiresAt).toEqual(previous.expiresAt);
	});

	it('rejects unauthenticated requests', async () => {
		const response = await createAuth().handler(
			new Request(`${BASE_URL}/api/auth/rotate-session`, { method: 'POST' }),
		);

		expect(response.status).toBe(401);
	});
});

type TestAuth = ReturnType<typeof createAuth>;

function createAuth() {
	return betterAuth({
		secret: 'test-secret-at-least-thirty-two-characters',
		baseURL: BASE_URL,
		basePath: '/api/auth',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: { enabled: true },
		plugins: [bearer(), sessionRotation()],
	});
}

async function signUp(auth: TestAuth) {
	const { token, user } = await auth.api.signUpEmail({
		body: { email: 'ada@example.com', password: 'Password123!', name: 'Ada' },
	});
	const session = await getSession(auth, token!);
	return {
		token: token!,
		userId: user.id,
		createdAt: session!.session.createdAt,
		expiresAt: session!.session.expiresAt,
	};
}

function getSession(auth: TestAuth, token: string) {
	return auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
}
