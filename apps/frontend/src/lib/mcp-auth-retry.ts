import { ALLOWED_IMAGE_MEDIA_TYPES } from '@nao/shared/types';
import type { UIMessage } from '@nao/backend/chat';
import type { ImageUploadData } from '@nao/shared/types';
import type { SendMessageArgs } from '@/hooks/use-agent';

export function lastUserMessagePayload(messages: UIMessage[]): SendMessageArgs | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== 'user') {
			continue;
		}
		const text = message.parts
			.filter((part) => part.type === 'text')
			.map((part) => (part as { text: string }).text)
			.join('\n')
			.trim();
		const images = message.parts.map(imageFromFilePart).filter((image): image is ImageUploadData => !!image);
		if (!text && images.length === 0) {
			return null;
		}
		return {
			text,
			...(images.length > 0 && { images }),
			...(message.citation && { citation: message.citation }),
		};
	}
	return null;
}

function imageFromFilePart(part: UIMessage['parts'][number]): ImageUploadData | null {
	if (part.type !== 'file') {
		return null;
	}
	const file = part as { mediaType?: string; url?: string };
	if (!file.url) {
		return null;
	}
	const match = file.url.match(/^data:([^;]+);base64,(.*)$/);
	const mediaType = file.mediaType ?? match?.[1];
	if (!match || !isImageMediaType(mediaType)) {
		return null;
	}
	return { mediaType, data: match[2] };
}

function isImageMediaType(value: unknown): value is ImageUploadData['mediaType'] {
	return typeof value === 'string' && ALLOWED_IMAGE_MEDIA_TYPES.includes(value as ImageUploadData['mediaType']);
}
