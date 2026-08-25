export type MattermostLoginCommand = {
	code: string;
};

export function parseMattermostLoginCommand(text: string): MattermostLoginCommand | null {
	const match = /^\s*\/?login(?:\s+(.+?))?\s*$/i.exec(text);
	if (!match) {
		return null;
	}
	return { code: match[1]?.trim() ?? '' };
}

export function getMattermostLoginCommandForUnlinkedUser(
	text: string,
	isAuthorLinked: boolean,
): MattermostLoginCommand | null {
	if (isAuthorLinked) {
		return null;
	}
	return parseMattermostLoginCommand(text);
}
