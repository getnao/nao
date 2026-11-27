/**
 * Hash routes of the bundled screens. The Rust side navigates to them (see `src-tauri/src/screens.rs`),
 * so names and parameters must stay in sync with that file.
 */
export type UnreachableReason = 'unreachable' | 'invalid_tls' | 'not_nao';

export type Route =
	| { name: 'servers' }
	| { name: 'add-server' }
	| { name: 'connecting'; serverId: string }
	| { name: 'signing-in'; serverId: string; signInUrl: string }
	| { name: 'sign-in'; serverId: string; error?: string }
	| { name: 'unreachable'; serverId: string; reason: UnreachableReason }
	| { name: 'too-old'; serverId: string; version?: string; minimum: string };

const SERVERS_ROUTE: Route = { name: 'servers' };
const UNREACHABLE_REASONS: UnreachableReason[] = ['unreachable', 'invalid_tls', 'not_nao'];

export function parseRoute(hash: string): Route {
	const [path, query = ''] = hash.replace(/^#/, '').split('?', 2);
	const params = new URLSearchParams(query);
	const serverId = params.get('server');

	if (path === '/add-server') {
		return { name: 'add-server' };
	}
	if (!serverId) {
		return SERVERS_ROUTE;
	}

	switch (path) {
		case '/connecting':
			return { name: 'connecting', serverId };
		case '/signing-in':
			return parseSigningInRoute(serverId, params);
		case '/sign-in':
			return { name: 'sign-in', serverId, error: params.get('error') ?? undefined };
		case '/unreachable':
			return { name: 'unreachable', serverId, reason: parseUnreachableReason(params.get('reason')) };
		case '/too-old':
			return parseTooOldRoute(serverId, params);
		default:
			return SERVERS_ROUTE;
	}
}

export function routeHash(route: Route): string {
	if (route.name === 'servers' || route.name === 'add-server') {
		return `#/${route.name}`;
	}
	const { name, serverId, ...rest } = route;
	const params = new URLSearchParams({ server: serverId });
	for (const [key, value] of Object.entries(rest)) {
		if (value !== undefined) {
			params.set(key, value);
		}
	}
	return `#/${name}?${params}`;
}

export function navigateTo(route: Route) {
	window.location.hash = routeHash(route);
}

export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

function parseSigningInRoute(serverId: string, params: URLSearchParams): Route {
	const signInUrl = params.get('signInUrl');
	if (!signInUrl || !isHttpUrl(signInUrl)) {
		return { name: 'sign-in', serverId };
	}
	return { name: 'signing-in', serverId, signInUrl };
}

function parseTooOldRoute(serverId: string, params: URLSearchParams): Route {
	return {
		name: 'too-old',
		serverId,
		version: params.get('version') ?? undefined,
		minimum: params.get('minimum') ?? '',
	};
}

function parseUnreachableReason(reason: string | null): UnreachableReason {
	return UNREACHABLE_REASONS.find((candidate) => candidate === reason) ?? 'unreachable';
}
