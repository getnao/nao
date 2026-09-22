import type { MentionOption } from 'prompt-mentions';
import type { ImageUploadData } from '@nao/shared/attachments';
import type { DocumentAttachment } from '@/lib/attachments';

export interface QueuedMessage {
	id: string;
	text: string;
	mentions: MentionOption[];
	images?: ImageUploadData[];
	documents?: DocumentAttachment[];
}

export type NewQueuedMessage = Omit<QueuedMessage, 'id'>;
