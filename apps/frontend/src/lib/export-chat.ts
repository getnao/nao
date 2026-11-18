/** Triggers a browser download of a text file with the given content. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
	downloadBlob(filename, new Blob([content], { type: mimeType }));
}

/** Triggers a browser download of a base64-encoded binary file (e.g. a backend-generated PDF). */
export function downloadBase64File(filename: string, base64: string, mimeType: string): void {
	const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
	downloadBlob(filename, new Blob([bytes], { type: mimeType }));
}

function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

/** Turns a chat title into a safe file slug. */
export function toFileSlug(title: string | undefined, fallback = 'nao-chat'): string {
	const slug = (title ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || fallback;
}
