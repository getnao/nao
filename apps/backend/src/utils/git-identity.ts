export interface GitIdentity {
	name: string;
	email: string;
}

export const NAO_CO_AUTHOR: GitIdentity = {
	name: 'nao',
	email: 'naoagent@getnao.io',
};

export function withCoAuthors(message: string, coAuthors: GitIdentity[]): string {
	if (coAuthors.length === 0) {
		return message;
	}
	const trailers = coAuthors.map((coAuthor) => `Co-authored-by: ${coAuthor.name} <${coAuthor.email}>`).join('\n');
	return `${message.trimEnd()}\n\n${trailers}`;
}

export function withRequester(body: string, requester: GitIdentity): string {
	return `${body}${body ? '\n\n' : ''}Requested by ${requester.name}`;
}
