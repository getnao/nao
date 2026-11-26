// @vitest-environment jsdom

import { STORY_PENDING_CHARTS_ATTRIBUTE } from '@nao/shared/story-app';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartPluginRenderContext } from '@nao/shared/chart-plugin';
import type * as StoryHost from '@/story-runtime/story-host';

import { Chart } from '@/story-runtime/story-kit/chart';

const host = vi.hoisted(() => ({
	editing: false,
	requestChartPlugin: vi.fn(),
	requestChartSettingsSave: vi.fn(),
}));

vi.mock('@/story-runtime/story-host', async (importOriginal) => ({
	...(await importOriginal<typeof StoryHost>()),
	isEditingEnabled: () => host.editing,
	requestChartPlugin: host.requestChartPlugin,
	requestChartSettingsSave: host.requestChartSettingsSave,
}));

const ROWS = [
	{ year: '2024', revenue: 10 },
	{ year: '2025', revenue: 12 },
];

type CapturingGlobal = typeof globalThis & {
	renderedContexts?: ChartPluginRenderContext[];
	finishDrawing?: () => void;
};

const capturing = globalThis as CapturingGlobal;
const blobUrls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	host.editing = false;
	URL.createObjectURL = blobUrls.create;
	URL.revokeObjectURL = blobUrls.revoke;
	capturing.renderedContexts = [];
	delete capturing.finishDrawing;
});

describe('Chart with a plugin type', () => {
	it.each([
		{ editing: false, mode: 'view', canSave: false },
		{ editing: true, mode: 'edit', canSave: true },
	])('gives the plugin its settings in $mode mode', async ({ editing, mode, canSave }) => {
		host.editing = editing;
		usePlugin('export function render(element, context) { globalThis.renderedContexts.push(context); }');

		render(<Chart type='waterfall' data={ROWS} xKey='year' settings={{ palette: 'warm' }} />);

		const context = await renderedContext();
		expect(context.settings).toEqual({ palette: 'warm' });
		expect(context.mode).toBe(mode);
		expect(context.saveSettings !== undefined).toBe(canSave);
	});

	it('saves settings into the props of its own block', async () => {
		host.editing = true;
		host.requestChartSettingsSave.mockResolvedValue(undefined);
		usePlugin('export function render(element, context) { globalThis.renderedContexts.push(context); }');

		render(<Chart type='waterfall' data={ROWS} xKey='year' title='Revenue bridge' />);
		await (await renderedContext()).saveSettings?.({ palette: 'cold' });

		expect(host.requestChartSettingsSave).toHaveBeenCalledWith({
			block: {
				component: 'Chart',
				props: { type: 'waterfall', data: ROWS, xKey: 'year', title: 'Revenue bridge' },
			},
			settings: { palette: 'cold' },
		});
	});

	it('counts as drawing until its render promise settles', async () => {
		usePlugin(
			'export function render() { return new Promise((resolve) => { globalThis.finishDrawing = resolve; }); }',
		);

		render(<Chart type='slow_waterfall' data={ROWS} xKey='year' />);

		await waitFor(() => expect(capturing.finishDrawing).toBeDefined());
		expect(document.documentElement.getAttribute(STORY_PENDING_CHARTS_ATTRIBUTE)).toBe('1');
		await act(async () => capturing.finishDrawing?.());
		await waitFor(() => expect(document.documentElement.hasAttribute(STORY_PENDING_CHARTS_ATTRIBUTE)).toBe(false));
	});
});

function usePlugin(source: string) {
	capturing.renderedContexts = [];
	host.requestChartPlugin.mockResolvedValue(source);
	URL.createObjectURL = () => `data:text/javascript,${encodeURIComponent(source)}`;
	URL.revokeObjectURL = () => {};
}

async function renderedContext(): Promise<ChartPluginRenderContext> {
	await waitFor(() => expect(capturing.renderedContexts?.length).toBeGreaterThan(0));
	return capturing.renderedContexts!.at(-1)!;
}
