// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomationsFeed } from './automations-feed';

vi.mock('@/components/tool-calls/display-chart', () => ({
	ChartDisplay: () => null,
}));

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
});
