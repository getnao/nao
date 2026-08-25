const MISSING_EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export type MattermostEmailCacheEntry = {
	email: string | null;
	expiresAt: number;
};

export type MattermostEmailCache = Map<string, MattermostEmailCacheEntry>;

export async function resolveMattermostAccount<T>(input: {
	userId: string;
	emailCache: MattermostEmailCache;
	fetchEmail: () => Promise<string | null>;
	findUser: (email: string) => Promise<T | null>;
	now?: () => number;
}): Promise<T | null> {
	const cachedEntry = input.emailCache.get(input.userId);
	if (cachedEntry && cachedEntry.expiresAt > (input.now ?? Date.now)()) {
		return cachedEntry.email ? input.findUser(cachedEntry.email) : null;
	}

	const email = await input.fetchEmail();
	cacheMattermostEmail(input.emailCache, input.userId, email, (input.now ?? Date.now)());
	if (!email) {
		return null;
	}
	const normalizedEmail = email.toLowerCase();
	return input.findUser(normalizedEmail);
}

export function cacheMattermostEmail(
	emailCache: MattermostEmailCache,
	userId: string,
	email: string | null,
	now = Date.now(),
): void {
	const normalizedEmail = email ? email.toLowerCase() : null;
	emailCache.set(userId, {
		email: normalizedEmail,
		expiresAt: normalizedEmail ? Number.POSITIVE_INFINITY : now + MISSING_EMAIL_CACHE_TTL_MS,
	});
}

export async function fetchMattermostUserEmail(input: {
	baseUrl: string;
	botToken: string;
	userId: string;
	fetchImpl?: typeof fetch;
}): Promise<string | null> {
	const profile = await fetchMattermostUserProfile(input);
	return profile?.email ?? null;
}

export async function fetchMattermostUserProfile(input: {
	baseUrl: string;
	botToken: string;
	userId: string;
	fetchImpl?: typeof fetch;
}): Promise<{ email: string | null; isBot: boolean } | null> {
	const url = new URL(input.baseUrl);
	const basePath = url.pathname.replace(/\/$/, '');
	url.pathname = `${basePath}/api/v4/users/${encodeURIComponent(input.userId)}`;
	const response = await (input.fetchImpl ?? fetch)(url, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${input.botToken}`,
		},
	});
	if (!response.ok) {
		return null;
	}
	const user = (await response.json()) as { email?: unknown; is_bot?: unknown };
	return {
		email: typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null,
		isBot: user.is_bot === true,
	};
}
