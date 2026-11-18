import { DISPOSABLE_EMAIL_DOMAINS } from './disposable-email-domains';

/** Names reserved for documentation and testing (RFC 2606), which never receive mail. */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org', 'example', 'invalid', 'localhost', 'test'];

const BLOCKED_DOMAINS = new Set([...DISPOSABLE_EMAIL_DOMAINS, ...RESERVED_DOMAINS]);

export function isDisposableEmail(email: string): boolean {
	const domain = email.split('@').at(-1)?.trim().toLowerCase() ?? '';
	return listDomainAndParents(domain).some((candidate) => BLOCKED_DOMAINS.has(candidate));
}

function listDomainAndParents(domain: string): string[] {
	const labels = domain.split('.');
	return labels.map((_, index) => labels.slice(index).join('.'));
}
