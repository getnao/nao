import { BACKEND_URL } from './backend';

const TEST_USER = { name: 'Desktop E2E', email: 'desktop-e2e@example.com', password: 'desktop-e2e-password' };

export interface LoopbackRequest {
	port: number;
	state: string;
}

/** Signs up the first user, as the browser would, and returns its session cookie. */
export async function signUpTestUser(): Promise<string> {
	const response = await fetch(`${BACKEND_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: BACKEND_URL },
		body: JSON.stringify(TEST_USER),
	});
	if (!response.ok) {
		throw new Error(`Sign-up failed with ${response.status}: ${await response.text()}`);
	}
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';', 1)[0])
		.join('; ');
}

/** Reads the loopback port and state that the app put in the /cli-login link. */
export function parseSignInLink(link: string): LoopbackRequest {
	const url = new URL(link);
	if (url.origin !== BACKEND_URL || url.pathname !== '/cli-login') {
		throw new Error(`Unexpected sign-in link: ${link}`);
	}
	if (url.searchParams.get('client') !== 'desktop') {
		throw new Error(`The sign-in link does not ask for a desktop code: ${link}`);
	}
	return { port: Number(url.searchParams.get('port')), state: url.searchParams.get('state') ?? '' };
}

/** Does what the /cli-login page does after the user clicks Authorize. */
export async function authorizeDesktopApp(sessionCookie: string): Promise<string> {
	const response = await fetch(`${BACKEND_URL}/api/cli-auth/authorize`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: BACKEND_URL, Cookie: sessionCookie },
		body: JSON.stringify({ client: 'desktop' }),
	});
	if (!response.ok) {
		throw new Error(`Authorization failed with ${response.status}: ${await response.text()}`);
	}
	const { code } = (await response.json()) as { code: string };
	return code;
}

/** Follows the browser redirect to the app's loopback listener. */
export async function sendLoopbackCallback(request: LoopbackRequest, code: string): Promise<Response> {
	const params = new URLSearchParams({ code, state: request.state });
	return fetch(`http://127.0.0.1:${request.port}/callback?${params}`);
}
