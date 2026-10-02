// @vitest-environment jsdom

import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearStaleActiveOrganization, getActiveOrganizationId, setActiveOrganizationId } from './active-organization';
import { getActiveProjectId, setActiveProjectId } from './active-project';
import type { TrpcRouter } from '@nao/backend/trpc';

describe('active organization storage', () => {
	beforeEach(() => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			clear: () => values.clear(),
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});
	});

	afterEach(() => vi.unstubAllGlobals());

	it('stores and returns the selected organization', () => {
		setActiveOrganizationId('organization-id');

		expect(getActiveOrganizationId()).toBe('organization-id');
		expect(localStorage.getItem('nao.active-organization-id')).toBe('"organization-id"');
	});

	it('returns null when no organization is selected', () => {
		expect(getActiveOrganizationId()).toBeNull();
	});

	it('ignores invalid saved values', () => {
		localStorage.setItem('nao.active-organization-id', 'not-json');

		expect(getActiveOrganizationId()).toBeNull();
	});

	it.each([
		['NOT_FOUND', -32004, 404, null, null, true],
		['FORBIDDEN', -32003, 403, 'organization-id', 'project-id', false],
	])(
		'handles a parsed %s error',
		(code, rpcCode, httpStatus, expectedOrganization, expectedProject, expectedCleared) => {
			setActiveOrganizationId('organization-id');
			setActiveProjectId('project-id');
			const error = TRPCClientError.from<TrpcRouter>({
				error: { code: rpcCode, message: 'error', data: { code, httpStatus } },
			});

			expect(error.data?.code).toBe(code);
			expect(clearStaleActiveOrganization(error)).toBe(expectedCleared);
			expect(getActiveOrganizationId()).toBe(expectedOrganization);
			expect(getActiveProjectId()).toBe(expectedProject);
		},
	);
});
