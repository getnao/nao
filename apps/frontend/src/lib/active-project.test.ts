// @vitest-environment jsdom

import { expect, it, vi } from 'vitest';

import { subscribeToExternalActiveProjectChanges } from './active-project';

it('notifies subscribers when another tab changes the active project', () => {
	const listener = vi.fn();
	const unsubscribe = subscribeToExternalActiveProjectChanges(listener);

	window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
	window.dispatchEvent(new StorageEvent('storage', { key: 'nao.active-project-id' }));

	expect(listener).toHaveBeenCalledOnce();
	unsubscribe();
});
