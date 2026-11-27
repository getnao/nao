export type LoginClient = 'cli' | 'desktop';

export interface LoginClientCopy {
	heading: string;
	title: string;
	description: string;
	authorizedTitle: string;
	authorizedMessage: string;
	deniedMessage: string;
	authorizeError: string;
	invalidRequest: string;
}

const LOGIN_CLIENT_COPY: Record<LoginClient, LoginClientCopy> = {
	cli: {
		heading: 'Connect the CLI',
		title: 'Authorize nao CLI',
		description: 'The nao CLI on this computer is requesting access to your nao account.',
		authorizedTitle: 'CLI authorized',
		authorizedMessage: 'You can close this window and return to your terminal.',
		deniedMessage: 'You have denied the nao CLI access to your account. You can close this window.',
		authorizeError: 'Could not authorize the CLI. Please try again.',
		invalidRequest: 'Invalid CLI login request: missing or invalid port or state parameter.',
	},
	desktop: {
		heading: 'Connect the desktop app',
		title: 'Authorize nao desktop app',
		description: 'The nao desktop app on this computer is requesting access to your nao account.',
		authorizedTitle: 'Desktop app authorized',
		authorizedMessage: 'You can close this window and return to the app.',
		deniedMessage: 'You have denied the nao desktop app access to your account. You can close this window.',
		authorizeError: 'Could not authorize the desktop app. Please try again.',
		invalidRequest: 'Invalid desktop sign-in request: missing or invalid port or state parameter.',
	},
};

export function parseLoginClient(value: unknown): LoginClient {
	return value === 'desktop' ? 'desktop' : 'cli';
}

export function getLoginClientCopy(client: LoginClient): LoginClientCopy {
	return LOGIN_CLIENT_COPY[client];
}

export function parseCallbackPort(port: string | undefined): number | null {
	if (!port || !/^\d+$/.test(port)) {
		return null;
	}
	const parsed = Number(port);
	if (parsed < 1 || parsed > 65535) {
		return null;
	}
	return parsed;
}

export function buildCallbackUrl(port: number, params: Record<string, string>): string {
	return `http://127.0.0.1:${port}/callback?${new URLSearchParams(params)}`;
}
