// @vitest-environment jsdom

import { USER_GROUP_FEATURE_DEFINITIONS } from '@nao/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserGroupFeatureCard } from '@/components/settings/user-group-feature-card';

afterEach(cleanup);

const storyFeature = USER_GROUP_FEATURE_DEFINITIONS.find((feature) => feature.key === 'storyCreation')!;
const automationFeature = USER_GROUP_FEATURE_DEFINITIONS.find((feature) => feature.key === 'automationCreation')!;
const storyCardName = `${storyFeature.label}. ${storyFeature.description}`;

describe('UserGroupFeatureCard', () => {
	it('renders selected and unselected states with button semantics', () => {
		const { rerender } = render(
			<UserGroupFeatureCard feature={storyFeature} selected={false} onSelectedChange={vi.fn()} />,
		);
		const card = screen.getByRole('button', { name: storyCardName });

		expect(card.getAttribute('aria-pressed')).toBe('false');
		expect(card.getAttribute('type')).toBe('button');

		rerender(<UserGroupFeatureCard feature={storyFeature} selected onSelectedChange={vi.fn()} />);

		expect(screen.getByRole('button', { name: storyCardName }).getAttribute('aria-pressed')).toBe('true');
	});

	it('toggles the selected value when clicked', () => {
		const onSelectedChange = vi.fn();
		const { rerender } = render(
			<UserGroupFeatureCard feature={storyFeature} selected={false} onSelectedChange={onSelectedChange} />,
		);

		fireEvent.click(screen.getByRole('button', { name: storyCardName }));
		expect(onSelectedChange).toHaveBeenLastCalledWith(true);

		rerender(<UserGroupFeatureCard feature={storyFeature} selected onSelectedChange={onSelectedChange} />);
		fireEvent.click(screen.getByRole('button', { name: storyCardName }));
		expect(onSelectedChange).toHaveBeenLastCalledWith(false);
	});

	it('renders both feature labels, descriptions, and previews', () => {
		render(
			<>
				<UserGroupFeatureCard feature={storyFeature} selected onSelectedChange={vi.fn()} />
				<UserGroupFeatureCard feature={automationFeature} selected={false} onSelectedChange={vi.fn()} />
			</>,
		);

		expect(screen.getByText(storyFeature.label)).toBeTruthy();
		expect(screen.getByText(storyFeature.description)).toBeTruthy();
		expect(screen.getByTestId('story-creation-preview')).toBeTruthy();
		expect(screen.getByText(automationFeature.label)).toBeTruthy();
		expect(screen.getByText(automationFeature.description)).toBeTruthy();
		expect(screen.getByTestId('automation-creation-preview')).toBeTruthy();
	});
});
