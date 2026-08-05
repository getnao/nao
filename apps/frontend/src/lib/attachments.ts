import { getActiveProjectId } from '@/lib/active-project';

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
		throw new Error(await readErrorMessage(response, file.name));
	}

	return response.json();
}

async function readErrorMessage(response: Response, fileName: string): Promise<string> {
	try {
		const { error } = await response.json();
		if (typeof error === 'string' && error) {
			return error;
		}
	} catch {
		// Fall through to a generic message when the body is not the usual error envelope.
	}
	return `Could not upload ${fileName}`;
}
