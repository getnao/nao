import { describe, expect, it } from 'vitest';

import type { DBMessagePart } from '../src/db/abstractSchema';
import { convertDBPartToUIPart, convertUIPartToDBPart } from '../src/utils/chat-message-part-mappings';

const asDBPart = (part: Partial<DBMessagePart>): DBMessagePart => {
	return { id: 'part-1', messageId: 'msg-1', order: 0, createdAt: new Date(), ...part } as DBMessagePart;
};

describe('file parts', () => {
	it('stores an image by id and reads it back as an image URL', () => {
		const dbPart = convertUIPartToDBPart(
			{ type: 'file', mediaType: 'image/png', url: '/i/2f1c9b3e-0000-4000-8000-000000000000' },
			'msg-1',
			0,
		);

		expect(dbPart).toMatchObject({
			type: 'file',
			mediaType: 'image/png',
			imageId: '2f1c9b3e-0000-4000-8000-000000000000',
			storagePath: null,
		});
		expect(convertDBPartToUIPart(asDBPart(dbPart))).toEqual({
			type: 'file',
			mediaType: 'image/png',
			url: '/i/2f1c9b3e-0000-4000-8000-000000000000',
		});
	});

	it('stores an uploaded document as a path inside the user space', () => {
		const dbPart = convertUIPartToDBPart(
			{
				type: 'file',
				mediaType: 'text/csv',
				filename: 'sales.csv',
				url: '/home/uploads/2026-08-04/sales.csv',
			},
			'msg-1',
			1,
		);

		expect(dbPart).toMatchObject({
			type: 'file',
			mediaType: 'text/csv',
			imageId: null,
			storagePath: 'uploads/2026-08-04/sales.csv',
			filename: 'sales.csv',
		});
		expect(convertDBPartToUIPart(asDBPart(dbPart))).toEqual({
			type: 'file',
			mediaType: 'text/csv',
			filename: 'sales.csv',
			url: '/home/uploads/2026-08-04/sales.csv',
		});
	});

	it('drops a file part that points at neither an image nor permanent storage', () => {
		const dbPart = convertUIPartToDBPart(
			{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,iVBOR' },
			'msg-1',
			0,
		);

		expect(dbPart).toBeUndefined();
	});

	it('drops a stored file part whose columns were cleared', () => {
		const part = asDBPart({ type: 'file', mediaType: 'text/csv', imageId: null, storagePath: null });
		expect(convertDBPartToUIPart(part)).toBeUndefined();
	});
});
