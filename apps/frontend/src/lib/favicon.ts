import { createLocalStorage } from '@/lib/local-storage';

const FAVICON_PATHS = ['/favicon.ico', '/favicon.png', '/apple-touch-icon.png'];

/** How long a browser trusts what it found for a service before looking again. */
const LOOKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type FaviconLookup = { src: string | null; checkedAt: number };

const lookupStorage = createLocalStorage<Record<string, FaviconLookup>>('nao-favicon-lookups', {});

let lookups: Record<string, FaviconLookup> | null = null;

/**
 * Icons to try for a service: the one already found for it, or every guess when it is unknown.
 * Services that turned out to have no icon return none, so a browser stops asking them.
 */
export const resolveFaviconCandidates = (url?: string | null): string[] => {
	const known = getKnownFavicon(url);
	if (known) {
		return known.src ? [known.src] : [];
	}
	return getFaviconCandidates(url ?? undefined);
};

/** Remember what a service serves, so later page loads skip the lookup entirely. */
export const rememberFavicon = (url: string | null | undefined, src: string | null): void => {
	const key = getServiceKey(url);
	if (!key) {
		return;
	}
	lookups = { ...readLookups(), [key]: { src, checkedAt: Date.now() } };
	try {
		lookupStorage.set(lookups);
	} catch {
		// A browser refusing to store leaves the lookup in memory for this page load.
	}
};

/** Icons a service may serve for itself, best guess first, never fetched from a third party. */
export const getFaviconCandidates = (url?: string): string[] => {
	if (!url) {
		return [];
	}
	try {
		const { origin, protocol, hostname } = new URL(url);
		const parentOrigin = getParentDomainOrigin(protocol, hostname);
		const origins = parentOrigin && parentOrigin !== origin ? [origin, parentOrigin] : [origin];
		return origins.flatMap((candidateOrigin) => FAVICON_PATHS.map((path) => `${candidateOrigin}${path}`));
	} catch {
		return [];
	}
};

function getKnownFavicon(url?: string | null): FaviconLookup | null {
	const key = getServiceKey(url);
	if (!key) {
		return null;
	}
	const lookup = readLookups()[key];
	if (!lookup || Date.now() - lookup.checkedAt > LOOKUP_TTL_MS) {
		return null;
	}
	return lookup;
}

function readLookups(): Record<string, FaviconLookup> {
	lookups ??= lookupStorage.get() ?? {};
	return lookups;
}

/** Services sharing an origin share an icon, whatever path each of them is mounted on. */
function getServiceKey(url?: string | null): string | null {
	if (!url) {
		return null;
	}
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

/**
 * API hosts such as `api.acme.com` rarely serve an icon, while the domain they belong to does. Only
 * these subdomains are climbed: dropping any label would reach an unrelated site on the domains that
 * host a tenant per subdomain, such as `tenant.github.io`.
 */
const API_SUBDOMAINS = new Set(['api', 'mcp', 'llm', 'inference', 'gateway']);

function getParentDomainOrigin(protocol: string, hostname: string): string | null {
	const [subdomain, ...parentLabels] = hostname.split('.');
	if (parentLabels.length < 2 || !API_SUBDOMAINS.has(subdomain)) {
		return null;
	}
	return `${protocol}//${parentLabels.join('.')}`;
}
