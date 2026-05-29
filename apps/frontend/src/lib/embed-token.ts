export function readEmbedTokenFromLocation(search: string): string {
	const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('token');
	if (!raw) {
		return '';
	}
	if (raw.startsWith('"') && raw.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(raw);
			return typeof parsed === 'string' ? parsed : raw;
		} catch {
			return raw;
		}
	}
	return raw;
}

export function isLikelyMcpAppPayloadToken(token: string): boolean {
	return token.startsWith('{') && (token.includes('"block"') || token.includes('"embedUrl"'));
}
