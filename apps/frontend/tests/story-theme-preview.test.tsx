// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoryThemePreview } from '@/components/settings/story-theme-preview';

/**
 * The preview mounts real story components, which is the point of it - and also
 * the risk. It went out crashing the whole settings page once, because nothing
 * ever rendered it outside a browser. This mounts it on every run.
 */

vi.mock('@/main', () => ({
	trpc: {
		storyTheme: { getActive: { queryOptions: () => ({ queryKey: ['storyTheme'], queryFn: async () => null }) } },
		story: {
			getFilterOptions: { queryOptions: () => ({ queryKey: ['opts'], queryFn: async () => ({ options: [] }) }) },
		},
		storyShare: {
			getFilterOptions: {
				queryOptions: () => ({ queryKey: ['sharedOpts'], queryFn: async () => ({ options: [] }) }),
			},
		},
	},
	queryClient: {},
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-query')>()),
	useQuery: () => ({ data: undefined, isPending: false, error: null }),
}));

afterEach(cleanup);

describe('StoryThemePreview', () => {
	it('renders without crashing on the default theme', () => {
		render(<StoryThemePreview theme={DEFAULT_STORY_THEME} />);
		expect(screen.getByText('Weekly active users')).toBeDefined();
	});

	it('shows six chart series, so the whole palette can be judged', () => {
		render(<StoryThemePreview theme={DEFAULT_STORY_THEME} />);
		for (const country of ['United States', 'France', 'Spain', 'United Kingdom', 'India', 'Germany']) {
			expect(screen.getAllByText(country).length, `${country} missing from the preview`).toBeGreaterThan(0);
		}
	});

	it('renders a themed brand without crashing', () => {
		render(
			<StoryThemePreview
				theme={{
					...DEFAULT_STORY_THEME,
					surfaces: { page: '#fffdf7', card: '#f6f2ea', sunken: '#ece7dd' },
					ink: { primary: '#121212', secondary: '#444444', muted: '#777777' },
					accent: '#8f40ff',
					charts: {
						...DEFAULT_STORY_THEME.charts,
						series: ['#5197dc', '#a5561b', '#3a9dcf', '#3a803b', '#b478c2', '#00835d'],
					},
				}}
			/>,
		);
		expect(screen.getByText('Users per week by country')).toBeDefined();
	});
});
