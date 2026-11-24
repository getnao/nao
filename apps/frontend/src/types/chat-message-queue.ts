import type { MentionOption } from 'prompt-mentions';
import type { ImageUploadData } from '@nao/shared/attachments';
import type { CitationData } from '@nao/shared/types';
import type { DocumentAttachment } from '@/lib/attachments';

export interface QueuedMessage {
	id: string;
	text: string;
	mentions: MentionOption[];
	images?: ImageUploadData[];
	documents?: DocumentAttachment[];
	citations?: CitationData[];
	/** Sent to the running agent, which reads it once its current tools finish. */
	steer?: boolean;
}

export type NewQueuedMessage = Omit<QueuedMessage, 'id'>;
