import { IncomingHttpHeaders } from 'node:http';

/** Convert fastify headers to basic `Headers` for better-auth. */
export const convertHeaders = (headers: IncomingHttpHeaders) => {
	const convertedHeaders = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (value) {
			convertedHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
		}
	}
	return convertedHeaders;
};

export const isAbortError = (error: unknown): error is Error & { name: 'AbortError' } => {
	return error instanceof Error && error.name === 'AbortError';
};

export const getErrorMessage = (error: unknown): string | null => {
	if (!error) {
		return null;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

export const buildGithubAllowlist = (allowedUsers?: string): Set<string> => {
	const allowed = new Set<string>();
	if (allowedUsers) {
		for (const login of allowedUsers.split(',')) {
			const trimmed = login.trim();
			if (trimmed) {
				allowed.add(trimmed);
			}
		}
	}
	return allowed;
};

export const normalizeEmailDomains = (raw: string): string[] => {
	const seen = new Set<string>();
	for (const entry of raw.split(',')) {
		const domain = entry.trim().toLowerCase().replace(/^@/, '');
		if (domain) {
			seen.add(domain);
		}
	}
	return [...seen];
};

export const getEmailDomain = (email: string): string | null => {
	return email.split('@').at(1)?.trim().toLowerCase() || null;
};

/**
 * Free / consumer email providers. These can never be claimed for organization
 * sign-in routing, since anyone can hold an address on them.
 */
const PUBLIC_EMAIL_DOMAINS = new Set<string>([
	'gmail.com',
	'googlemail.com',
	'outlook.com',
	'hotmail.com',
	'hotmail.co.uk',
	'live.com',
	'msn.com',
	'yahoo.com',
	'yahoo.co.uk',
	'ymail.com',
	'icloud.com',
	'me.com',
	'mac.com',
	'aol.com',
	'proton.me',
	'protonmail.com',
	'pm.me',
	'gmx.com',
	'gmx.net',
	'gmx.de',
	'mail.com',
	'zoho.com',
	'yandex.com',
	'yandex.ru',
	'qq.com',
	'163.com',
	'126.com',
	'fastmail.com',
	'hey.com',
]);

export const isPublicEmailDomain = (domain: string): boolean => {
	return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
};

export const isEmailDomainAllowed = (userEmail: string, authDomains?: string) => {
	if (authDomains) {
		const allowedDomains = authDomains.split(',').map((domain) => domain.trim().toLowerCase());
		const userEmailDomain = userEmail.split('@').at(1)?.toLowerCase();
		if (!userEmailDomain) {
			return false;
		}
		return allowedDomains.includes(userEmailDomain);
	}
	return false;
};

/**
 * Resolve the auth provider ID from the better-auth callback context.
 * Social providers use `params.id`, the genericOAuth plugin (OIDC) uses `params.providerId`.
 */
export function resolveProviderId(ctx?: { params?: Record<string, string> } | null): string | undefined {
	return ctx?.params?.id ?? ctx?.params?.providerId;
}

export const regexPassword = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$/;

export const replaceEnvVars = (fileContent: string) => {
	const replaced = fileContent.replace(/\$\{(\w+)\}/g, (match, varName) => {
		return process.env[varName] || match;
	});
	return replaced;
};

/** Truncate a string to a maximum length and add an ellipsis in the middle. */
export const truncateMiddle = (str: string, maxLength: number, ellipsis: string = '...'): string => {
	if (str.length <= maxLength) {
		return str;
	}
	if (maxLength <= ellipsis.length) {
		return str.slice(0, maxLength);
	}
	const half = Math.floor((maxLength - ellipsis.length) / 2);
	return str.slice(0, half) + ellipsis + str.slice(-half);
};

export const removeNewLine = (str: string): string => {
	return str.replace(/[\r\n]/g, '');
};

export function groupBy<T, K extends string>(
	items: T[],
	keyFn: (item: T) => K,
	filterFn?: (item: T) => boolean,
): Record<K, T[]> {
	return items.reduce(
		(acc, item) => {
			if (filterFn && !filterFn(item)) {
				return acc;
			}
			const key = keyFn(item);
			if (!acc[key]) {
				acc[key] = [];
			}
			acc[key].push(item);
			return acc;
		},
		{} as Record<K, T[]>,
	);
}

export const buildCredentialPreviews = (
	credentials: Record<string, string> | null | undefined,
): Record<string, string> | null => {
	if (!credentials) {
		return null;
	}
	return Object.fromEntries(
		Object.entries(credentials).map(([key, val]) => [key, val ? val.slice(0, 4) + '...' + val.slice(-4) : '']),
	);
};

export const formatSize = (bytes: number) => {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
