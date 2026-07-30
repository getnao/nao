import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as contextFileEditQueries from '../src/queries/context-file-edit.queries';
import * as userQueries from '../src/queries/user.queries';
import {
	addContextFileEditors,
	clearAllContextFileEdits,
	clearContextFileEdits,
	recordContextFileEdit,
} from '../src/services/context-file-edit.service';

vi.mock('../src/queries/context-file-edit.queries', () => ({
	upsertContextFileEdit: vi.fn(),
	getContextFileEdits: vi.fn(),
	deleteContextFileEdits: vi.fn(),
	deleteAllContextFileEdits: vi.fn(),
}));

vi.mock('../src/queries/user.queries', () => ({
	getUserNames: vi.fn(),
}));

describe('context file edit attribution', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('records the latest editor using a normalized path', async () => {
		await recordContextFileEdit('project-1', 'docs\\context.md', 'user-1');
		await recordContextFileEdit('project-1', '/docs/context.md', 'user-2');

		expect(contextFileEditQueries.upsertContextFileEdit).toHaveBeenNthCalledWith(
			1,
			'project-1',
			'/docs/context.md',
			'user-1',
		);
		expect(contextFileEditQueries.upsertContextFileEdit).toHaveBeenNthCalledWith(
			2,
			'project-1',
			'/docs/context.md',
			'user-2',
		);
	});

	it('clears selected paths without clearing other records', async () => {
		await clearContextFileEdits('project-1', ['one.md']);

		expect(contextFileEditQueries.deleteContextFileEdits).toHaveBeenCalledWith('project-1', ['/one.md']);
		expect(contextFileEditQueries.deleteAllContextFileEdits).not.toHaveBeenCalled();
	});

	it('clears every record for the project', async () => {
		await clearAllContextFileEdits('project-1');

		expect(contextFileEditQueries.deleteAllContextFileEdits).toHaveBeenCalledWith('project-1');
	});

	it('adds known editors and leaves unknown changes without an editor field', async () => {
		const updatedAt = new Date('2026-07-29T12:00:00.000Z');
		vi.mocked(contextFileEditQueries.getContextFileEdits).mockResolvedValue([
			{
				id: 'edit-1',
				projectId: 'project-1',
				path: '/known.md',
				userId: 'user-1',
				updatedAt,
			},
		]);
		vi.mocked(userQueries.getUserNames).mockResolvedValue(new Map([['user-1', 'Ada']]));

		const result = await addContextFileEditors('project-1', [
			{ path: '/known.md', kind: 'modified' },
			{ path: '/unknown.md', kind: 'modified' },
		]);

		expect(result).toEqual([
			{
				path: '/known.md',
				kind: 'modified',
				lastEditor: {
					id: 'user-1',
					name: 'Ada',
				},
				lastEditedAt: updatedAt.getTime(),
			},
			{ path: '/unknown.md', kind: 'modified' },
		]);
		expect(userQueries.getUserNames).toHaveBeenCalledTimes(1);
		expect(userQueries.getUserNames).toHaveBeenCalledWith(['user-1']);
	});
});
