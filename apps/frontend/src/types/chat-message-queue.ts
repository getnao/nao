import type { MentionOption } from 'prompt-mentions';

export interface QueuedMessage {
	id: string;
	text: string;
	mentions: MentionOption[];
}

export type NewQueuedMessage = Omit<QueuedMessage, 'id'>;
