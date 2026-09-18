// @vitest-environment jsdom

import { USER_GROUP_FEATURE_DEFINITIONS } from '@nao/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserGroupFeatureCard } from './user-group-feature-card';

afterEach(cleanup);

const storyFeature = USER_GROUP_FEATURE_DEFINITIONS.find((feature) => feature.key === 'story-creation')!;
const automationFeature = USER_GROUP_FEATURE_DEFINITIONS.find((feature) => feature.key === 'automation-creation')!;

describe('UserGroupFeatureCard', () => {
	it('renders selected and unselected states with button semantics', () => {
		const { rerender } = render(
			<UserGroupFeatureCard feature={storyFeature} selected={false} onSelectedChange={vi.fn()} />,
		);
		const accessibleName = `${storyFeature.label}. ${storyFeature.description}`;
		const card = screen.getByRole('button', { name: accessibleName });

		expect(card.getAttribute('aria-pressed')).toBe('false');
		expect(card.getAttribute('type')).toBe('button');

		rerender(<UserGroupFeatureCard feature={storyFeature} selected onSelectedChange={vi.fn()} />);

		expect(screen.getByRole('button', { name: accessibleName }).getAttribute('aria-pressed')).toBe('true');
	});

	it('toggles the selected value when clicked', () => {
		const onSelectedChange = vi.fn();
		const { rerender } = render(
			<UserGroupFeatureCard feature={storyFeature} selected={false} onSelectedChange={onSelectedChange} />,
		);
		const accessibleName = `${storyFeature.label}. ${storyFeature.description}`;

		fireEvent.click(screen.getByRole('button', { name: accessibleName }));
		expect(onSelectedChange).toHaveBeenLastCalledWith(true);

		rerender(<UserGroupFeatureCard feature={storyFeature} selected onSelectedChange={onSelectedChange} />);
		fireEvent.click(screen.getByRole('button', { name: accessibleName }));
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
