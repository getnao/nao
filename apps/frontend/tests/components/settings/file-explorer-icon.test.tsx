// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';

afterEach(cleanup);

function renderIconClass(props: Parameters<typeof FileExplorerIcon>[0]): string {
	const { container } = render(<FileExplorerIcon {...props} />);
	return container.querySelector('svg')?.getAttribute('class') ?? '';
}

describe('FileExplorerIcon', () => {
	it('shows a test pipe for test definitions in the tests folder', () => {
		expect(renderIconClass({ name: 'revenue.yml', type: 'file', path: '/tests/revenue.yml' })).toContain(
			'tabler-icon-test-pipe',
		);
	});

	it('keeps the YAML icon for YAML files outside the tests folder', () => {
		expect(renderIconClass({ name: 'revenue.yml', type: 'file', path: '/semantics/revenue.yml' })).toContain(
			'tabler-icon-settings-code',
		);
	});

	it('keeps the YAML icon for test outputs', () => {
		expect(
			renderIconClass({ name: 'results_1.yml', type: 'file', path: '/tests/outputs/results_1.yml' }),
		).toContain('tabler-icon-settings-code');
	});

	it('keeps the YAML icon when no path is given', () => {
		expect(renderIconClass({ name: 'revenue.yml', type: 'file' })).toContain('tabler-icon-settings-code');
	});
});
