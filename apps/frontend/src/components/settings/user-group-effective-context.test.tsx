// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { UserGroupEffectiveContext } from './user-group-effective-context';
import type { ComponentProps } from 'react';

const contextObjects = [
	{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
	{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' },
];
const docsEntries = [
	{ kind: 'file' as const, path: 'readme.md' },
	{ kind: 'file' as const, path: 'finance/kpis.md' },
];

afterEach(cleanup);

describe('UserGroupEffectiveContext content', () => {
	it('shows one empty state and no search when both sources are empty', () => {
		renderEffectiveContext({
			databaseAccess: {
				mode: 'restricted',
				strict: true,
				grants: [],
				patterns: ['public.future_*'],
			},
			contextObjects: [],
			docsEntries: [],
		});

		expect(screen.getAllByText('No context available')).toHaveLength(1);
		expect(screen.queryByRole('textbox', { name: 'Search effective context' })).toBeNull();
		expect(screen.queryByText('Database tables')).toBeNull();
		expect(screen.queryByText('Docs')).toBeNull();
		expect(screen.getByText('Dynamic table patterns')).toBeTruthy();
		expect(screen.getByText('public.future_*')).toBeTruthy();
	});

	it('shows only the database tree when docs are empty', () => {
		renderEffectiveContext({ docsEntries: [] });

		expect(screen.getByRole('button', { name: 'Expand app/public folder' })).toBeTruthy();
		expect(screen.queryByText('Docs')).toBeNull();
		expect(screen.queryByText('No context available')).toBeNull();
		expect(screen.getByRole('textbox', { name: 'Search effective context' })).toBeTruthy();
	});

	it('shows only the docs tree when tables are empty', () => {
		renderEffectiveContext({ contextObjects: [] });

		expect(screen.getByRole('button', { name: 'Expand docs folder' })).toBeTruthy();
		expect(screen.queryByText('Database tables')).toBeNull();
		expect(screen.queryByText('No context available')).toBeNull();
		expect(screen.getByRole('textbox', { name: 'Search effective context' })).toBeTruthy();
	});

	it('keeps source issues visible when there is no searchable context', () => {
		renderEffectiveContext({
			contextObjects: [],
			docsEntries: [],
			databaseCatalogState: 'error',
			docsSyncState: 'missing',
		});

		expect(screen.getByText('Database tables')).toBeTruthy();
		expect(screen.getByText('Failed to load')).toBeTruthy();
		expect(screen.getByText('Docs')).toBeTruthy();
		expect(screen.getByText('Not synced')).toBeTruthy();
		expect(screen.queryByText('No context available')).toBeNull();
		expect(screen.queryByRole('textbox', { name: 'Search effective context' })).toBeNull();
	});
});

describe('UserGroupEffectiveContext search', () => {
	it('shows one empty state when neither source matches', () => {
		renderEffectiveContext();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search effective context' }), {
			target: { value: 'missing' },
		});

		expect(screen.getAllByText('No matches')).toHaveLength(1);
		expect(screen.queryByText('Database tables')).toBeNull();
		expect(screen.queryByText('Docs')).toBeNull();
	});

	it('shows only database matches', () => {
		renderEffectiveContext();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search effective context' }), {
			target: { value: 'users' },
		});

		expect(screen.getByText('users')).toBeTruthy();
		expect(screen.queryByText('readme.md')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Collapse docs folder' })).toBeNull();
		expect(screen.queryByText('No matches')).toBeNull();
	});

	it('shows only docs matches', () => {
		renderEffectiveContext();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search effective context' }), {
			target: { value: 'readme' },
		});

		expect(screen.getByText('readme.md')).toBeTruthy();
		expect(screen.queryByText('users')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Collapse app/public folder' })).toBeNull();
		expect(screen.queryByText('No matches')).toBeNull();
	});
});

type EffectiveContextProps = ComponentProps<typeof UserGroupEffectiveContext>;

function renderEffectiveContext(overrides: Partial<EffectiveContextProps> = {}) {
	return render(
		<UserGroupEffectiveContext
			databaseAccess={{ mode: 'all', strict: true }}
			docsAccess={{ mode: 'all' }}
			contextObjects={contextObjects}
			docsEntries={docsEntries}
			{...overrides}
		/>,
	);
}
