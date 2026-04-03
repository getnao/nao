import type { MentionOption } from 'prompt-mentions';
import type { ImageUploadData } from '@nao/shared/types';

export interface QueuedMessage {
	id: string;
	text: string;
	mentions: MentionOption[];
	images?: ImageUploadData[];
}

export type NewQueuedMessage = Omit<QueuedMessage, 'id'>;
