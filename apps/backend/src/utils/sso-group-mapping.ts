/* @license Enterprise */

import { isMicrosoftEntraGroupId } from '@nao/shared';
import type { UserRole } from '@nao/shared/types';

import { ORG_ROLES, type OrgRole } from '../types/organization';

const PROJECT_ROLE_PRECEDENCE: readonly UserRole[] = ['admin', 'context_admin', 'user', 'viewer'];
const ORGANIZATION_ROLE_PRECEDENCE: readonly OrgRole[] = ['admin', 'user', 'viewer'];

export interface OidcGroupNaoGroupMapping {
	oidcGroup: string;
	projectScope: string;
	naoUserGroup: string;
}

export type OidcGroupNaoGroupMappingParseResult =
	| { status: 'valid'; mappings: OidcGroupNaoGroupMapping[] }
	| { status: 'invalid'; problem: string };

export interface EntraGroupNaoGroupMapping {
	entraGroupId: string;
	projectScope: string;
	naoUserGroup: string;
}

export type EntraGroupNaoGroupMappingParseResult =
	| { status: 'valid'; mappings: EntraGroupNaoGroupMapping[] }
	| { status: 'invalid'; problem: string };

export type EntraGroupOrganizationRoleMappingParseResult =
	| { status: 'valid'; mapping: Map<string, OrgRole> }
	| { status: 'invalid'; problem: string };

export function parseOidcGroupNaoGroupMapping(raw: string | undefined): OidcGroupNaoGroupMappingParseResult {
	if (!raw?.trim()) {
		return { status: 'valid', mappings: [] };
	}

	const mappings = new Map<string, OidcGroupNaoGroupMapping>();
	for (const rawEntry of raw.split(',')) {
		const parts = rawEntry.split(':');
		if (parts.length !== 3) {
			return { status: 'invalid', problem: 'each entry must contain exactly two colons' };
		}

		const [rawOidcGroup, rawProjectScope, rawNaoUserGroup] = parts;
		const oidcGroup = rawOidcGroup.trim().toLowerCase();
		const projectScope = rawProjectScope.trim();
		const naoUserGroup = rawNaoUserGroup.trim().toLowerCase();
		if (!oidcGroup || !projectScope || !naoUserGroup) {
			return { status: 'invalid', problem: 'group, project scope, and User Group must all be set' };
		}

		const key = `${oidcGroup}\0${projectScope}`;
		const existing = mappings.get(key);
		if (existing && existing.naoUserGroup !== naoUserGroup) {
			return {
				status: 'invalid',
				problem: 'the same OIDC group and project scope cannot map to different groups',
			};
		}
		mappings.set(key, { oidcGroup, projectScope, naoUserGroup });
	}

	return { status: 'valid', mappings: [...mappings.values()] };
}

export function parseEntraGroupNaoGroupMapping(raw: string | undefined): EntraGroupNaoGroupMappingParseResult {
	if (!raw?.trim()) {
		return { status: 'valid', mappings: [] };
	}

	const mappings = new Map<string, EntraGroupNaoGroupMapping>();
	for (const rawEntry of raw.split(',')) {
		const parts = rawEntry.split(':');
		if (parts.length !== 3) {
			return { status: 'invalid', problem: 'each entry must contain exactly two colons' };
		}

		const [rawGroupId, rawProjectScope, rawNaoUserGroup] = parts;
		const entraGroupId = rawGroupId.trim().toLowerCase();
		const projectScope = rawProjectScope.trim();
		const naoUserGroup = rawNaoUserGroup.trim().toLowerCase();
		if (!isMicrosoftEntraGroupId(entraGroupId)) {
			return { status: 'invalid', problem: 'source identifiers must be Microsoft Entra group Object IDs' };
		}
		if (!projectScope || !naoUserGroup) {
			return { status: 'invalid', problem: 'project scope and User Group must both be set' };
		}

		const key = `${entraGroupId}\0${projectScope}`;
		const existing = mappings.get(key);
		if (existing && existing.naoUserGroup !== naoUserGroup) {
			return {
				status: 'invalid',
				problem: 'the same Entra group and project scope cannot map to different groups',
			};
		}
		mappings.set(key, { entraGroupId, projectScope, naoUserGroup });
	}

	return { status: 'valid', mappings: [...mappings.values()] };
}

export function resolveOidcGroupNaoGroupMappings(
	claimedGroups: string[],
	projectId: string,
	mappings: OidcGroupNaoGroupMapping[],
): Map<string, string> {
	const resolved = new Map<string, string>();
	for (const claimedGroup of normalizeGroupNames(claimedGroups)) {
		const projectMapping = mappings.find(
			(mapping) => mapping.oidcGroup === claimedGroup && mapping.projectScope === projectId,
		);
		const wildcardMapping = mappings.find(
			(mapping) => mapping.oidcGroup === claimedGroup && mapping.projectScope === '*',
		);
		const mapping = projectMapping ?? wildcardMapping;
		if (mapping) {
			resolved.set(claimedGroup, mapping.naoUserGroup);
		}
	}
	return resolved;
}

export function resolveOidcGroupNaoGroupMappingTargets<T extends { name: string }>(
	projectId: string,
	mappings: OidcGroupNaoGroupMapping[],
	targets: T[],
): Map<string, T> {
	const identifiers = mappings
		.filter((mapping) => mapping.projectScope === projectId || mapping.projectScope === '*')
		.map((mapping) => mapping.oidcGroup);
	const resolvedMappings = resolveOidcGroupNaoGroupMappings(identifiers, projectId, mappings);
	const targetsByName = new Map(targets.map((target) => [target.name.trim().toLowerCase(), target]));

	return new Map(
		[...resolvedMappings].flatMap(([identifier, targetName]) => {
			const target = targetsByName.get(targetName.trim().toLowerCase());
			return target ? [[identifier, target] as const] : [];
		}),
	);
}

export function resolveEntraGroupNaoGroupMappingTargets<T extends { name: string }>(
	projectId: string,
	mappings: EntraGroupNaoGroupMapping[],
	targets: T[],
): Map<string, T> {
	const identifiers = mappings
		.filter((mapping) => mapping.projectScope === projectId || mapping.projectScope === '*')
		.map((mapping) => mapping.entraGroupId);
	const resolvedMappings = resolveEntraGroupNaoGroupMappings(identifiers, projectId, mappings);
	const targetsByName = new Map(targets.map((target) => [target.name.trim().toLowerCase(), target]));

	return new Map(
		[...resolvedMappings].flatMap(([identifier, targetName]) => {
			const target = targetsByName.get(targetName.trim().toLowerCase());
			return target ? [[identifier, target] as const] : [];
		}),
	);
}

export function resolveEntraGroupNaoGroupMappings(
	claimedGroupIds: string[],
	projectId: string,
	mappings: EntraGroupNaoGroupMapping[],
): Map<string, string> {
	return resolveGroupNaoGroupMappings(
		claimedGroupIds,
		projectId,
		mappings.map((mapping) => ({
			identifier: mapping.entraGroupId,
			projectScope: mapping.projectScope,
			targetName: mapping.naoUserGroup,
		})),
	);
}

export function resolveStrongestUserRole(roles: Iterable<UserRole>): UserRole | null {
	const matched = new Set(roles);
	return PROJECT_ROLE_PRECEDENCE.find((role) => matched.has(role)) ?? null;
}

/**
 * Maps `group:role` pairs, keyed by lowercased group name.
 * Unknown roles are dropped rather than throwing, so one typo cannot lock everyone out.
 */
export function parseGroupOrganizationRoleMapping(raw: string | undefined): Map<string, OrgRole> {
	const mapping = new Map<string, OrgRole>();
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
		if (group && isOrganizationRole(role)) {
			mapping.set(group, role);
		}
	}

	return mapping;
}

export function parseEntraGroupOrganizationRoleMapping(
	raw: string | undefined,
): EntraGroupOrganizationRoleMappingParseResult {
	const mapping = new Map<string, OrgRole>();
	if (!raw?.trim()) {
		return { status: 'valid', mapping };
	}

	for (const rawEntry of raw.split(',')) {
		const parts = rawEntry.split(':');
		if (parts.length !== 2) {
			return { status: 'invalid', problem: 'each entry must contain exactly one colon' };
		}
		const groupId = parts[0].trim().toLowerCase();
		const role = parts[1].trim();
		if (!isMicrosoftEntraGroupId(groupId)) {
			return { status: 'invalid', problem: 'source identifiers must be Microsoft Entra group Object IDs' };
		}
		if (!isOrganizationRole(role)) {
			return { status: 'invalid', problem: 'roles must be admin, user, or viewer' };
		}
		const existing = mapping.get(groupId);
		if (existing && existing !== role) {
			return { status: 'invalid', problem: 'the same Entra group cannot map to different roles' };
		}
		mapping.set(groupId, role);
	}

	return { status: 'valid', mapping };
}

export function resolveOrganizationRoleFromGroups(groups: string[], mapping: Map<string, OrgRole>): OrgRole | null {
	const matched = new Set<OrgRole>();
	for (const group of groups) {
		const role = mapping.get(group.trim().toLowerCase());
		if (role) {
			matched.add(role);
		}
	}

	return ORGANIZATION_ROLE_PRECEDENCE.find((role) => matched.has(role)) ?? null;
}

export interface GroupOrganizationRoleMappingDecision {
	action: 'allow' | 'deny';
	organizationRole: OrgRole | null;
	claimPresent: boolean;
}

export function decideGroupOrganizationRoleMapping(
	claims: Record<string, unknown> | null,
	claimName: string,
	mapping: Map<string, OrgRole>,
): GroupOrganizationRoleMappingDecision {
	if (!claims || !(claimName in claims)) {
		return { action: 'allow', organizationRole: null, claimPresent: false };
	}

	const organizationRole = resolveOrganizationRoleFromGroups(extractGroups(claims, claimName), mapping);
	return organizationRole
		? { action: 'allow', organizationRole, claimPresent: true }
		: { action: 'deny', organizationRole: null, claimPresent: true };
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

export type GroupsClaimResult = { status: 'missing' } | { status: 'malformed' } | { status: 'valid'; groups: string[] };

export function readGroupsClaim(claims: Record<string, unknown>, claimName: string): GroupsClaimResult {
	if (!(claimName in claims)) {
		return { status: 'missing' };
	}

	const value = claims[claimName];
	if (typeof value === 'string') {
		return {
			status: 'valid',
			groups: value
				.split(',')
				.map((group) => group.trim())
				.filter(Boolean),
		};
	}
	if (Array.isArray(value)) {
		if (!value.every((group) => typeof group === 'string')) {
			return { status: 'malformed' };
		}
		return { status: 'valid', groups: value };
	}
	return { status: 'malformed' };
}

function isOrganizationRole(value: string): value is OrgRole {
	return (ORG_ROLES as readonly string[]).includes(value);
}

function normalizeGroupNames(groups: string[]): Set<string> {
	return new Set(groups.map((group) => group.trim().toLowerCase()).filter(Boolean));
}

function resolveGroupNaoGroupMappings(
	claimedGroups: string[],
	projectId: string,
	mappings: Array<{ identifier: string; projectScope: string; targetName: string }>,
): Map<string, string> {
	const resolved = new Map<string, string>();
	for (const claimedGroup of normalizeGroupNames(claimedGroups)) {
		const projectMapping = mappings.find(
			(mapping) => mapping.identifier === claimedGroup && mapping.projectScope === projectId,
		);
		const wildcardMapping = mappings.find(
			(mapping) => mapping.identifier === claimedGroup && mapping.projectScope === '*',
		);
		const mapping = projectMapping ?? wildcardMapping;
		if (mapping) {
			resolved.set(claimedGroup, mapping.targetName);
		}
	}
	return resolved;
}
