/* @license Enterprise */

import type { UserRole } from '@nao/shared/types';
import { USER_ROLES } from '@nao/shared/types';

/** Most privileged first: a user in several mapped groups gets the strongest of them. */
const ROLE_PRECEDENCE: readonly UserRole[] = ['admin', 'context_admin', 'user', 'viewer'];

/**
 * Maps `group:role` pairs, keyed by lowercased group name.
 * Unknown roles are dropped rather than throwing, so one typo cannot lock everyone out.
 */
export function parseGroupRoleMapping(raw: string | undefined): Map<string, UserRole> {
	const mapping = new Map<string, UserRole>();
	if (!raw) {
		return mapping;
	}

	for (const entry of raw.split(',')) {
		const separator = entry.lastIndexOf(':');
		if (separator === -1) {
			continue;
		}

		const group = entry.slice(0, separator).trim().toLowerCase();
		const role = entry.slice(separator + 1).trim();
		if (group && isUserRole(role)) {
			mapping.set(group, role);
		}
	}

	return mapping;
}

export function resolveRoleFromGroups(groups: string[], mapping: Map<string, UserRole>): UserRole | null {
	const matched = new Set<UserRole>();
	for (const group of groups) {
		const role = mapping.get(group.trim().toLowerCase());
		if (role) {
			matched.add(role);
		}
	}

	return ROLE_PRECEDENCE.find((role) => matched.has(role)) ?? null;
}

export interface GroupRoleMappingDecision {
	action: 'allow' | 'deny';
	role: UserRole | null;
	claimPresent: boolean;
}

export function decideGroupRoleMapping(
	claims: Record<string, unknown> | null,
	claimName: string,
	mapping: Map<string, UserRole>,
): GroupRoleMappingDecision {
	if (!claims || !(claimName in claims)) {
		return { action: 'allow', role: null, claimPresent: false };
	}

	const role = resolveRoleFromGroups(extractGroups(claims, claimName), mapping);
	return role ? { action: 'allow', role, claimPresent: true } : { action: 'deny', role: null, claimPresent: true };
}

export function extractGroups(claims: Record<string, unknown>, claimName: string): string[] {
	const value = claims[claimName];
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((group) => group.trim())
			.filter(Boolean);
	}
	if (Array.isArray(value)) {
		return value.filter((group): group is string => typeof group === 'string');
	}
	return [];
}

function isUserRole(value: string): value is UserRole {
	return (USER_ROLES as readonly string[]).includes(value);
}
