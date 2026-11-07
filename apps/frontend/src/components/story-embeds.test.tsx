// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMapBlock } from '@nao/shared/story-segments';
import { StoryMapEmbed } from './story-embeds';
import { EditorStoryMapEditProvider } from '@/contexts/story-map-edit';

vi.mock('@/main', () => ({ trpc: {} }));

vi.mock('@/hooks/use-source-query', () => ({
	useSourceQuery: () => ({ sourceData: undefined }),
}));

vi.mock('@/components/story-map-embed', () => ({
	StoryMapRender: () => <div>map rendered</div>,
}));

afterEach(cleanup);

function renderMapEmbed(attributes: string) {
	const map = { ...parseMapBlock(attributes)!, rawTag: `<map ${attributes} />` };
	const queryData = { q1: { data: [{ lat: 48.85, lng: 2.35 }], columns: ['lat', 'lng'] } };
	render(
		<QueryClientProvider client={new QueryClient()}>
			<EditorStoryMapEditProvider onReplaceTag={() => {}}>
				<StoryMapEmbed map={map} queryData={queryData} />
			</EditorStoryMapEditProvider>
		</QueryClientProvider>,
	);
}

describe('StoryMapEmbed', () => {
	it('shows a placeholder naming the missing coordinate columns', () => {
		renderMapEmbed('query_id="q1" map_type="scatter_bubble" title="Stores"');

		expect(
			screen.getByText(
				'Map cannot be displayed: the <map> tag is missing latitude_key, longitude_key (query: q1)',
			),
		).toBeTruthy();
		expect(screen.queryByText('map rendered')).toBeNull();
		expect(screen.getByTitle('Edit map')).toBeTruthy();
	});

	it('renders a complete map', () => {
		renderMapEmbed('query_id="q1" map_type="points" latitude_key="lat" longitude_key="lng" title="Stores"');

		expect(screen.getByText('map rendered')).toBeTruthy();
	});
});
