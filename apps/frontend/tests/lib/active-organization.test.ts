// @vitest-environment jsdom

import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubLocalStorage } from '../helpers/browser-stubs';
import type { TrpcRouter } from '@nao/backend/trpc';
import {
	clearStaleActiveOrganization,
	getActiveOrganizationId,
	setActiveOrganizationId,
} from '@/lib/active-organization';
import { getActiveProjectId, setActiveProjectId } from '@/lib/active-project';

describe('active organization storage', () => {
	beforeEach(stubLocalStorage);

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

	it('leaves storage unchanged when the request has no selection', () => {
		setActiveProjectId('project-id');
		const error = createTrpcError('NOT_FOUND', -32004, 404);

		expect(clearStaleActiveOrganization(null, null, error)).toBe(false);
		expect(getActiveOrganizationId()).toBeNull();
		expect(getActiveProjectId()).toBe('project-id');
	});

	it.each([
		[null, 'project-id', null, true],
		[null, 'previous-project-id', 'project-id', false],
		['organization-id', 'project-id', 'project-id', false],
	])(
		'handles a project fallback request after selecting organization %s',
		(activeOrganization, requestedProject, expectedProject, expectedCleared) => {
			setActiveOrganizationId(activeOrganization);
			setActiveProjectId('project-id');
			const error = createTrpcError('NOT_FOUND', -32004, 404);

			expect(clearStaleActiveOrganization(null, requestedProject, error)).toBe(expectedCleared);
			expect(getActiveOrganizationId()).toBe(activeOrganization);
			expect(getActiveProjectId()).toBe(expectedProject);
		},
	);

	it.each([
		['NOT_FOUND', -32004, 404, 'organization-id', null, null, true],
		['NOT_FOUND', -32004, 404, 'previous-organization-id', 'organization-id', 'project-id', false],
		['FORBIDDEN', -32003, 403, 'organization-id', 'organization-id', 'project-id', false],
	])(
		'handles a parsed %s error',
		(code, rpcCode, httpStatus, requestedOrganization, expectedOrganization, expectedProject, expectedCleared) => {
			setActiveOrganizationId('organization-id');
			setActiveProjectId('project-id');
			const error = createTrpcError(code, rpcCode, httpStatus);

			expect(error.data?.code).toBe(code);
			expect(clearStaleActiveOrganization(requestedOrganization, null, error)).toBe(expectedCleared);
			expect(getActiveOrganizationId()).toBe(expectedOrganization);
			expect(getActiveProjectId()).toBe(expectedProject);
		},
	);
});

function createTrpcError(code: string, rpcCode: number, httpStatus: number) {
	return TRPCClientError.from<TrpcRouter>({ error: { code: rpcCode, message: 'error', data: { code, httpStatus } } });
}
