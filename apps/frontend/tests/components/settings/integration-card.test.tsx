// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';

import { IntegrationCard } from '@/components/settings/integration-card';

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		to,
		params: _params,
		children,
		...props
	}: ComponentProps<'a'> & { to: string; params?: unknown; children?: ReactNode }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

describe('IntegrationCard', () => {
	it('uses the OAuth URL for both the card and connect action', () => {
		render(
			<IntegrationCard
				id='slack'
				name='Slack'
				icon={TestIcon}
				connected={false}
				summary='Chat with nao from Slack'
				connectUrl='https://nao.test/api/slack/oauth/install?projectId=project-1'
			/>,
		);

		const connectLink = screen.getByRole('link', { name: 'Connect' });
		expect(connectLink.getAttribute('href')).toBe('https://nao.test/api/slack/oauth/install?projectId=project-1');
		expect(connectLink.getAttribute('target')).toBe('_blank');
		expect(connectLink.getAttribute('rel')).toBe('noopener noreferrer');
		const cardLink = screen.getByRole('link', { name: 'Connect Slack' });
		expect(cardLink.getAttribute('href')).toBe('https://nao.test/api/slack/oauth/install?projectId=project-1');
		expect(cardLink.getAttribute('target')).toBe('_blank');
		expect(cardLink.getAttribute('rel')).toBe('noopener noreferrer');
	});
});

function TestIcon({ className }: { className?: string }) {
	return <svg className={className} />;
}
