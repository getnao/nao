import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getExampleProjectForUser: vi.fn(),
}));

vi.mock('../src/services/example-project', () => ({
	getExampleProjectForUser: mocks.getExampleProjectForUser,
}));

import { resolveAttachmentProject } from '../src/routes/attachment';

describe('resolveAttachmentProject', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('uses the selected project without resolving the trial project', async () => {
		const selectedProject = { id: 'project-id' };

		await expect(resolveAttachmentProject('user-id', selectedProject as never)).resolves.toBe(selectedProject);
		expect(mocks.getExampleProjectForUser).not.toHaveBeenCalled();
	});

	it('uses the example project for an eligible trial user', async () => {
		const exampleProject = { id: 'example-project-id' };
		mocks.getExampleProjectForUser.mockResolvedValue(exampleProject);

		await expect(resolveAttachmentProject('user-id', null)).resolves.toBe(exampleProject);
		expect(mocks.getExampleProjectForUser).toHaveBeenCalledWith('user-id');
	});

	it('rejects users without a selected or eligible example project', async () => {
		mocks.getExampleProjectForUser.mockResolvedValue(null);

		await expect(resolveAttachmentProject('user-id', null)).rejects.toThrow('No project');
	});
});
