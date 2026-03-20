import type { MentionOption } from 'prompt-mentions';
import type { ImageUploadData } from '@/hooks/use-agent';

export interface QueuedMessage {
	id: string;
	text: string;
	mentions: MentionOption[];
	images?: ImageUploadData[];
}

export type NewQueuedMessage = Omit<QueuedMessage, 'id'>;
