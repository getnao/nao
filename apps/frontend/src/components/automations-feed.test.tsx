// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomationsFeed } from './automations-feed';

vi.mock('@/components/tool-calls/display-chart', () => ({
	ChartDisplay: () => null,
}));
vi.mock('@/components/story-embeds', () => ({
	StoryChartEmbed: () => null,
	StoryMapEmbed: () => null,
	StoryTableEmbed: () => null,
}));
vi.mock('@/components/story-rendering', () => ({
	SegmentList: () => null,
}));
vi.mock('@/main', () => ({ trpc: {} }));

describe('AutomationsFeed', () => {
	afterEach(cleanup);

	it('does not tell users without creation access to create an Automation', () => {
		render(<AutomationsFeed items={[]} isLoading={false} hasAutomations={false} canCreateAutomation={false} />);

		expect(screen.getByText('Automation and live Story activity will appear here.')).toBeDefined();
		expect(screen.queryByText(/create your first automation/i)).toBeNull();
	});

	it('keeps the creation guidance for users with creation access', () => {
		render(<AutomationsFeed items={[]} isLoading={false} hasAutomations={false} canCreateAutomation />);

		expect(screen.getByText(/create your first automation/i)).toBeDefined();
	});

	it('tells someone they were given edit rights on a story already shared with them', () => {
		renderSharedNotification({ role: 'editor', isRoleChange: true });

		expect(screen.getByText(/gave you/).textContent).toBe('Alice gave you edit rights on this story.');
	});

	it('tells someone their access to a story was changed to view only', () => {
		renderSharedNotification({ role: 'viewer', isRoleChange: true });

		expect(screen.getByText(/changed your access/).textContent).toBe(
			'Alice changed your access to this story to view only.',
		);
	});

	it('tells a new recipient they can edit the story', () => {
		renderSharedNotification({ role: 'editor' });

		expect(screen.getByText(/shared this story/).textContent).toBe(
			'Alice shared this story with you, with edit rights.',
		);
	});
});

function renderSharedNotification(access: { role: 'viewer' | 'editor'; isRoleChange?: boolean }) {
	render(
		<AutomationsFeed
			items={[
				{
					kind: 'notification',
					id: 'notification-1',
					startedAt: new Date('2026-11-05T10:00:00Z'),
					notification: {
						id: 'notification-1',
						category: 'shared',
						title: 'Alice shared a story with you',
						body: '"Revenue"',
						linkUrl: null,
						payload: {
							kind: 'shared',
							sharerName: 'Alice',
							itemLabel: 'story',
							itemTitle: 'Revenue',
							visibility: 'specific',
							...access,
						},
						readAt: null,
					},
				},
			]}
			isLoading={false}
			hasAutomations={false}
			canCreateAutomation={false}
		/>,
	);
}
