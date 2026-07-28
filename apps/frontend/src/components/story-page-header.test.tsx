// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { StoryPageHeader } from './story-page-header';

// Mock Tooltip component since we don't have Radix fully configured in this simple test context
vi.mock('@/components/ui/tooltip', () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => <div data-testid='tooltip-wrapper'>{children}</div>,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
		<div data-testid='tooltip-trigger'>{children}</div>
	),
	TooltipContent: ({ children }: { children: React.ReactNode }) => (
		<div data-testid='tooltip-content' className='hidden'>
			{children}
		</div>
	),
}));

// Mock the time ago hook to return consistent text
vi.mock('@/hooks/use-time-ago', () => ({
	useTimeAgo: () => ({ humanReadable: '3h ago' }),
}));

// Mock icons
vi.mock('lucide-react', async () => {
	const actual = await vi.importActual('lucide-react');
	return {
		...actual,
		Activity: () => <span data-testid='activity-icon'>Activity</span>,
		Clock: () => <span data-testid='clock-icon'>Clock</span>,
	};
});

describe('StoryPageHeader - LiveControls', () => {
	it('renders timestamp when isLive is true and cachedAt is present', () => {
		const cachedAt = new Date().toISOString();
		render(
			<StoryPageHeader
				title='Test Story'
				live={{
					isLive: true,
					cachedAt,
					onOpenSettings: () => {},
				}}
			/>,
		);

		// "Updated 3h ago" (because timeAgo hook is mocked)
		expect(screen.getByText('Updated 3h ago')).toBeDefined();
	});

	it('does not render timestamp when isLive is false', () => {
		render(
			<StoryPageHeader
				title='Test Story'
				live={{
					isLive: false,
					cachedAt: new Date().toISOString(),
					onOpenSettings: () => {},
				}}
			/>,
		);

		expect(screen.queryByText(/Updated/i)).toBeNull();
	});

	it('does not render timestamp when isLive is true but cachedAt is null (never refreshed)', () => {
		render(
			<StoryPageHeader
				title='Test Story'
				live={{
					isLive: true,
					cachedAt: null,
					onOpenSettings: () => {},
				}}
			/>,
		);

		expect(screen.queryByText(/Updated/i)).toBeNull();
	});
});
