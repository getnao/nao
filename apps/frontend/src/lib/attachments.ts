import { getActiveProjectId } from '@/lib/active-project';
import { triggerDownload } from '@/lib/download';

export interface DocumentAttachment {
	/** Virtual path in the user's permanent storage, e.g. `/home/uploads/2026-08-04/sales.csv`. */
	path: string;
	filename: string;
	mediaType: string;
}

export interface UploadedAttachmentInfo extends DocumentAttachment {
	size: number;
}

/**
 * Puts a file in the sender's permanent storage before the message referencing it is sent,
 * so a large attachment never has to travel inside the message body.
 */
export async function uploadAttachment(file: File): Promise<UploadedAttachmentInfo> {
	const body = new FormData();
	body.append('file', file, file.name);

	const projectId = getActiveProjectId();
	const response = await fetch('/api/attachments', {
		method: 'POST',
		body,
		headers: projectId ? { 'x-nao-project-id': projectId } : undefined,
	});

	if (!response.ok) {
		throw new Error(await readErrorMessage(response, `Could not upload ${file.name}`));
	}

	return response.json();
}

/** The bytes of an attachment already in permanent storage, for previewing or saving it. */
export async function fetchAttachment(path: string): Promise<Blob> {
	const projectId = getActiveProjectId();
	const response = await fetch(`/api/attachments/file?path=${encodeURIComponent(path)}`, {
		headers: projectId ? { 'x-nao-project-id': projectId } : undefined,
	});

	if (!response.ok) {
		throw new Error(await readErrorMessage(response, `Could not open ${fileNameOf(path)}`));
	}

	return response.blob();
}

/** Reads attachment metadata without downloading its contents. */
export async function fetchAttachmentSize(path: string): Promise<number> {
	const projectId = getActiveProjectId();
	const response = await fetch(`/api/attachments/file?path=${encodeURIComponent(path)}`, {
		method: 'HEAD',
		headers: projectId ? { 'x-nao-project-id': projectId } : undefined,
	});

	if (!response.ok) {
		throw new Error(`Could not inspect ${fileNameOf(path)}`);
	}

	const contentLength = response.headers.get('Content-Length');
	const size = contentLength === null ? Number.NaN : Number(contentLength);
	if (!Number.isFinite(size) || size < 0) {
		throw new Error(`Could not determine the size of ${fileNameOf(path)}`);
	}
	return size;
}

export async function downloadAttachment(path: string): Promise<void> {
	triggerDownload(fileNameOf(path), await fetchAttachment(path));
}

export const fileNameOf = (path: string): string => path.split('/').pop() ?? path;

/** Permanent storage is mounted at `/home`; nao can open nothing outside it. */
export const isStoredFilePath = (path: string): boolean => /^\/home\/[^/].*$/.test(path);

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
	try {
		const { error } = await response.json();
		if (typeof error === 'string' && error) {
			return error;
		}
	} catch {
		// Fall through to a generic message when the body is not the usual error envelope.
	}
	return fallback;
}
