/** Uses the async clipboard API when available and falls back to a hidden textarea otherwise. */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return copyWithTextarea(text);
	}
}

function copyWithTextarea(text: string): boolean {
	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', '');
	textarea.className = 'fixed -left-[9999px]';
	document.body.appendChild(textarea);
	textarea.select();
	try {
		return document.execCommand('copy');
	} finally {
		textarea.remove();
	}
}
