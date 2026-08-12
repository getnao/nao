import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAttachmentPreview, MAX_TABULAR_PREVIEW_SIZE_MB } from './attachment-preview';

import { fetchAttachment, fetchAttachmentSize } from '@/lib/attachments';

vi.mock('@/lib/attachments', () => ({
	fetchAttachment: vi.fn(),
	fetchAttachmentSize: vi.fn(),
}));

describe('loadAttachmentPreview', () => {
	beforeEach(() => {
		vi.mocked(fetchAttachment).mockReset();
		vi.mocked(fetchAttachmentSize).mockReset();
	});

	it('does not download an oversized tabular file', async () => {
		vi.mocked(fetchAttachmentSize).mockResolvedValue(MAX_TABULAR_PREVIEW_SIZE_MB * 1024 * 1024 + 1);

		await expect(loadAttachmentPreview('/home/large.csv')).resolves.toEqual({ kind: 'too-large' });
		expect(fetchAttachment).not.toHaveBeenCalled();
	});
});
