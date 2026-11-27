import type { UnreachableReason } from '@/lib/routes';

export interface Server {
	id: string;
	name: string;
	url: string;
	lastUsedAt: number | null;
	builtIn: boolean;
}

export type CommandError =
	| { kind: 'invalid_url'; message: string }
	| { kind: 'unreachable' }
	| { kind: 'not_nao' }
	| { kind: 'too_old'; version: string | null; minimum: string }
	| { kind: 'invalid_tls' }
	| { kind: 'not_found' }
	| { kind: 'built_in' }
	| { kind: 'internal'; message: string };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** nao Cloud first, then self-hosted servers from the most recently used. */
export function sortServers(servers: Server[]): Server[] {
	return [...servers].sort(
		(left, right) =>
			Number(right.builtIn) - Number(left.builtIn) ||
			(right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0) ||
			left.name.localeCompare(right.name),
	);
}

export function findServer(servers: Server[] | undefined, id: string): Server | undefined {
	return servers?.find((server) => server.id === id);
}

export function isInsecureServerUrl(url: string): boolean {
	return /^http:\/\//i.test(url.trim());
}

export function displayHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export function formatLastUsed(lastUsedAt: number | null, now: number): string {
	if (lastUsedAt === null) {
		return 'Never used';
	}
	const elapsed = Math.max(0, now - lastUsedAt);
	if (elapsed < MINUTE_MS) {
		return 'Used just now';
	}
	if (elapsed < HOUR_MS) {
		return `Used ${Math.floor(elapsed / MINUTE_MS)} min ago`;
	}
	if (elapsed < DAY_MS) {
		return `Used ${Math.floor(elapsed / HOUR_MS)} h ago`;
	}
	const days = Math.floor(elapsed / DAY_MS);
	return `Used ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function isCommandError(error: unknown): error is CommandError {
	return typeof error === 'object' && error !== null && typeof (error as { kind?: unknown }).kind === 'string';
}

export function describeCommandError(error: unknown): string {
	if (!isCommandError(error)) {
		return typeof error === 'string' ? error : 'Something went wrong. Please try again.';
	}

	switch (error.kind) {
		case 'invalid_url':
			return error.message;
		case 'unreachable':
			return "We couldn't reach this server. Check the URL and your network connection.";
		case 'not_nao':
			return "This server doesn't look like a nao server.";
		case 'too_old':
			return describeTooOldServer(error.version ?? undefined, error.minimum);
		case 'invalid_tls':
			return "The server's TLS certificate isn't valid, so the connection isn't secure.";
		case 'not_found':
			return 'This server is no longer in your list.';
		case 'built_in':
			return "nao Cloud can't be removed.";
		case 'internal':
			return error.message || 'Something went wrong. Please try again.';
	}
}

export function describeTooOldServer(version: string | undefined, minimum: string): string {
	const running = version ? `runs nao ${version}` : 'runs a version of nao without desktop app support';
	return `This server ${running}. The desktop app needs nao ${minimum} or later. Ask your administrator to upgrade it.`;
}

export function describeUnreachableReason(reason: UnreachableReason): string {
	switch (reason) {
		case 'invalid_tls':
			return "The server's TLS certificate isn't valid, so the app refused to connect.";
		case 'not_nao':
			return "The server answered, but it doesn't look like a nao server anymore.";
		case 'unreachable':
			return "The server isn't responding. Check your network connection or try again in a moment.";
	}
}

export function describeSignInError(error: string | undefined): string | undefined {
	switch (error) {
		case undefined:
			return undefined;
		case 'access_denied':
			return 'Sign-in was denied in the browser.';
		case 'timeout':
			return 'Sign-in timed out. Please try again.';
		case 'desktop_auth_expired':
			return 'The sign-in link expired or was already used. Please sign in again.';
		case 'listener_failed':
			return "The app couldn't receive the sign-in response from your browser.";
		default:
			return "Sign-in didn't complete. Please try again.";
	}
}
