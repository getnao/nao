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

export const isEmailDomainAllowed = (userEmail: string, authDomains?: string) => {
	if (authDomains) {
		const allowedDomains = authDomains.split(',').map((domain) => domain.trim().toLowerCase());
		const userEmailDomain = userEmail.split('@').at(1)?.toLowerCase();
		if (!userEmailDomain) {
			return false;
		}
		return allowedDomains.includes(userEmailDomain);
	}
	return true;
};

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

export const formatSize = (bytes: number) => {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
