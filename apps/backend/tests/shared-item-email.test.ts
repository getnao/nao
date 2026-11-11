import { describe, expect, it, vi } from 'vitest';

import { buildSharedItemEmail } from '../src/utils/email-builders';

vi.mock('../src/utils/email-branding', () => ({
	resolveEmailBranding: async () => ({ appName: 'nao', brandColor: '#000000', isWhiteLabel: false }),
}));

const SHARE = { sharerName: 'Ada', itemLabel: 'story', itemTitle: 'Revenue', itemUrl: 'https://app.example/s/1' };

describe('the email telling someone an item was shared with them', () => {
	it('tells an editor they can edit the item', async () => {
		const email = await buildSharedItemEmail({ name: 'Grace' }, { ...SHARE, role: 'editor' });

		expect(email.subject).toBe('Ada shared "Revenue" with you with edit rights on nao');
		expect(email.html).toContain('You can edit it.');
		expect(email.html).toContain('Edit story');
	});

	it('keeps inviting a viewer to view the item', async () => {
		const email = await buildSharedItemEmail({ name: 'Grace' }, { ...SHARE, role: 'viewer' });

		expect(email.subject).toBe('Ada shared "Revenue" with you on nao');
		expect(email.html).not.toContain('You can edit it.');
		expect(email.html).toContain('View story');
	});
});
