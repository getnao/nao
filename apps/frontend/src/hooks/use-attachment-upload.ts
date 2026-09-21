import {
	documentMediaType,
	isImageMediaType,
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_IMAGE_SIZE_MB,
} from '@nao/shared/attachments';
import { useCallback, useRef, useState } from 'react';
import type { ImageMediaType, ImageUploadData } from '@nao/shared/attachments';

import type { DocumentAttachment } from '@/lib/attachments';
import { uploadAttachment } from '@/lib/attachments';

export type AttachmentKind = 'image' | 'document';

export interface Attachment {
	id: string;
	kind: AttachmentKind;
	name: string;
	size?: number;
	mediaType: string;
	/** Images only: data URL backing the thumbnail and the payload sent with the message. */
	dataUrl?: string;
	/** Documents only: path in permanent storage, known once the upload finishes. */
	path?: string;
	/** Set when the upload failed, so the user can retry or drop the file. */
	error?: string;
}

export interface AttachmentPayload {
	images?: ImageUploadData[];
	documents?: DocumentAttachment[];
}

interface UseAttachmentUploadOptions {
	/** Off when the instance has no permanent storage, which is where documents are kept. */
	documentsEnabled: boolean | undefined;
	maxDocumentSizeMb: number;
}

export function useAttachmentUpload({ documentsEnabled, maxDocumentSizeMb }: UseAttachmentUploadOptions) {
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [rejection, setRejection] = useState<string | undefined>(undefined);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const addFiles = useCallback(
		async (files: FileList | File[]) => {
			const candidates = Array.from(files);
			if (candidates.length === 0) {
				return;
			}

			setRejection(undefined);
			const accepted: File[] = [];
			for (const file of candidates) {
				const problem = describeRejection(file, { documentsEnabled, maxDocumentSizeMb });
				if (problem) {
					setRejection(problem);
				} else {
					accepted.push(file);
				}
			}

			const room = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - attachments.length);
			if (accepted.length > room) {
				setRejection(`A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments.`);
			}

			const withinLimit = accepted.slice(0, room);
			if (withinLimit.length === 0) {
				return;
			}

			const added = withinLimit.map(toPendingAttachment);
			setAttachments((previous) => [...previous, ...added]);

			await Promise.all(
				added.map((attachment, index) => prepare(attachment, withinLimit[index], setAttachments)),
			);
		},
		[attachments.length, documentsEnabled, maxDocumentSizeMb],
	);

	const removeAttachment = useCallback((id: string) => {
		setAttachments((previous) => previous.filter((attachment) => attachment.id !== id));
	}, []);

	const clearAttachments = useCallback(() => {
		setAttachments([]);
		setRejection(undefined);
	}, []);

	const restoreDocuments = useCallback((documents: DocumentAttachment[]) => {
		setAttachments((previous) => [
			...previous,
			...documents.map((document) => ({
				id: crypto.randomUUID(),
				kind: 'document' as const,
				name: document.filename,
				mediaType: document.mediaType,
				path: document.path,
			})),
		]);
	}, []);

	const openFilePicker = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			if (e.target.files) {
				addFiles(e.target.files);
			}
			e.target.value = '';
		},
		[addFiles],
	);

	const handlePaste = useCallback(
		(e: ClipboardEvent) => {
			const pasted = Array.from(e.clipboardData?.items ?? [])
				.filter((item) => item.kind === 'file')
				.map((item) => item.getAsFile())
				.filter((file): file is File => !!file);

			if (pasted.length > 0) {
				e.preventDefault();
				addFiles(pasted);
			}
		},
		[addFiles],
	);

	const getPayload = useCallback((): AttachmentPayload => {
		const images = attachments
			.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
			.map((attachment) => ({
				mediaType: attachment.mediaType as ImageMediaType,
				data: extractBase64(attachment.dataUrl!),
			}));
		const documents = attachments
			.filter((attachment) => attachment.path !== undefined)
			.map((attachment) => ({
				path: attachment.path!,
				filename: attachment.name,
				mediaType: attachment.mediaType,
			}));

		return {
			...(images.length > 0 && { images }),
			...(documents.length > 0 && { documents }),
		};
	}, [attachments]);

	return {
		attachments,
		rejection,
		fileInputRef,
		addFiles,
		removeAttachment,
		clearAttachments,
		restoreDocuments,
		openFilePicker,
		handleFileInputChange,
		handlePaste,
		getPayload,
		hasAttachments: attachments.some((attachment) => !attachment.error),
		hasErrors: attachments.some((attachment) => !!attachment.error),
		/** A document is still on its way to storage, so the message would reference nothing. */
		isPreparing: attachments.some(isPending),
	};
}

const isPending = (attachment: Attachment): boolean => {
	return !attachment.error && !attachment.dataUrl && !attachment.path;
};

const toPendingAttachment = (file: File): Attachment => ({
	id: crypto.randomUUID(),
	kind: isImageMediaType(file.type) ? 'image' : 'document',
	name: file.name,
	size: file.size,
	mediaType: isImageMediaType(file.type) ? file.type : (documentMediaType(file.name) ?? file.type),
});

/**
 * An image is only read into a data URL, because it travels inside the message. A document
 * is uploaded to permanent storage right away, so the message only has to name its path.
 */
const prepare = async (
	attachment: Attachment,
	file: File,
	setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
): Promise<void> => {
	const update = (changes: Partial<Attachment>) => {
		setAttachments((previous) =>
			previous.map((current) => (current.id === attachment.id ? { ...current, ...changes } : current)),
		);
	};

	try {
		if (attachment.kind === 'image') {
			update({ dataUrl: await readFileAsDataUrl(file) });
			return;
		}
		const { path, filename } = await uploadAttachment(file);
		update({ path, name: filename });
	} catch (error) {
		update({ error: error instanceof Error ? error.message : 'Upload failed' });
	}
};

const describeRejection = (
	file: File,
	{ documentsEnabled, maxDocumentSizeMb }: UseAttachmentUploadOptions,
): string | undefined => {
	if (isImageMediaType(file.type)) {
		return file.size === 0
			? `${file.name} is empty.`
			: file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024
				? `${file.name} is over the ${MAX_IMAGE_SIZE_MB} MB limit for images.`
				: undefined;
	}

	if (!documentMediaType(file.name)) {
		return `${file.name} is not a file type nao can read.`;
	}
	if (documentsEnabled === undefined) {
		return 'Storage configuration is still loading. Try attaching the document again in a moment.';
	}
	if (!documentsEnabled) {
		return 'Attaching files needs permanent storage, which is turned off on this instance.';
	}
	if (file.size > maxDocumentSizeMb * 1024 * 1024) {
		return `${file.name} is over the ${maxDocumentSizeMb} MB upload limit.`;
	}
	return undefined;
};

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

function extractBase64(dataUrl: string): string {
	const idx = dataUrl.indexOf(',');
	return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}
