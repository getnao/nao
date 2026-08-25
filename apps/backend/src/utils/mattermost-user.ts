export async function resolveMattermostAccount<T>(input: {
	userId: string;
	emailCache: Map<string, string>;
	fetchEmail: () => Promise<string | null>;
	findUser: (email: string) => Promise<T | null>;
}): Promise<T | null> {
	const cachedEmail = input.emailCache.get(input.userId);
	const email = cachedEmail ?? (await input.fetchEmail());
	if (!email) {
		return null;
	}
	const normalizedEmail = email.toLowerCase();
	input.emailCache.set(input.userId, normalizedEmail);
	return input.findUser(normalizedEmail);
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
