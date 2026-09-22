import { beforeEach, describe, expect, it, vi } from 'vitest';
import writeXlsxFile from 'write-excel-file/universal';

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

	it('previews a workbook as a table', async () => {
		const blob = await writeXlsxFile([
			[{ type: String, value: 'name' }],
			[{ type: String, value: 'Alpha' }],
		]).toBlob();
		vi.mocked(fetchAttachmentSize).mockResolvedValue(blob.size);
		vi.mocked(fetchAttachment).mockResolvedValue(blob);

		await expect(loadAttachmentPreview('/home/book.xlsx')).resolves.toEqual({
			kind: 'table',
			sheets: [
				{
					name: 'Sheet1',
					truncated: false,
					columns: ['name'],
					rows: [{ name: 'Alpha' }],
				},
			],
		});
	});
});
