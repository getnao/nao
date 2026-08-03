const MAX_TITLE_LENGTH = 255;
const MAX_FALLBACK_TITLE_LENGTH = 60;

export const TITLE_MAX_OUTPUT_TOKENS = 1024;

export function sanitizeTitle(text: string): string {
	const firstLine = firstNonEmptyLine(text);
	return truncate(firstLine.replace(/^["'`]+|["'`]+$/g, '').trim(), MAX_TITLE_LENGTH);
}

export function titleFromPrompt(prompt: string): string {
	return truncate(firstNonEmptyLine(prompt), MAX_FALLBACK_TITLE_LENGTH);
}

function firstNonEmptyLine(text: string): string {
	return text.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
}

function truncate(title: string, maxLength: number): string {
	return title.length > maxLength ? `${title.slice(0, maxLength - 3)}...` : title;
}
