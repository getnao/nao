import { MAX_IMAGE_SIZE_MB } from '@nao/shared/attachments';
import { describe, expect, it } from 'vitest';

import { AgentRequestUserMessageSchema } from '../src/types/chat';

describe('AgentRequestUserMessageSchema', () => {
	it('enforces the decoded image size limit on the server schema', () => {
		const oversized = Buffer.alloc(MAX_IMAGE_SIZE_MB * 1024 * 1024 + 1).toString('base64');
		const parsed = AgentRequestUserMessageSchema.safeParse({
			text: '',
			images: [{ mediaType: 'image/png', data: oversized }],
		});

		expect(parsed.success).toBe(false);
	});
});
