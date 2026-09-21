export function shouldSyncStoryEditorContent({
	editorMarkdown,
	incomingCode,
	lastEmittedMarkdown,
}: {
	editorMarkdown: string;
	incomingCode: string;
	lastEmittedMarkdown: string | null;
}): boolean {
	if (editorMarkdown === incomingCode) {
		return false;
	}
	if (lastEmittedMarkdown === null || !hasStructuralOuterBlankLines(incomingCode)) {
		return true;
	}
	return stripStructuralOuterBlankLines(incomingCode) !== stripStructuralOuterBlankLines(lastEmittedMarkdown);
}

function hasStructuralOuterBlankLines(code: string): boolean {
	return /^(?:[ \t]*\r?\n)+/.test(code) && /(?:\r?\n[ \t]*)+$/.test(code);
}

function stripStructuralOuterBlankLines(code: string): string {
	return code.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
}
