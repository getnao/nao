/* @license Enterprise */

import type { UserRole } from '@nao/shared/types';
import { z } from 'zod/v4';

import { LOG_LEVELS, LOG_SOURCES } from './log';
import type { OrgRole } from './organization';

/** `user` is the email of the user who made the request; for an API-key request, of the user who created the key. */
export const INSTANCE_LOG_TEXT_COLUMNS = ['message', 'context', 'project', 'organization', 'user'] as const;
export type InstanceLogTextColumn = (typeof INSTANCE_LOG_TEXT_COLUMNS)[number];

export const INSTANCE_LOG_TEXT_OPERATORS = [
	'contains',
	'notContains',
	'equals',
	'notEquals',
	'startsWith',
	'isEmpty',
	'isNotEmpty',
] as const;
export type InstanceLogTextOperator = (typeof INSTANCE_LOG_TEXT_OPERATORS)[number];

export const INSTANCE_LOG_SORT_KEYS = [
	'createdAt',
	'level',
	'source',
	'message',
	'project',
	'organization',
	'user',
] as const;
export type InstanceLogSortKey = (typeof INSTANCE_LOG_SORT_KEYS)[number];

const VALUELESS_TEXT_OPERATORS: ReadonlySet<InstanceLogTextOperator> = new Set(['isEmpty', 'isNotEmpty']);

export const instanceLogFilterSchema = z.discriminatedUnion('column', [
	z.object({ column: z.literal('createdAt'), operator: z.enum(['after', 'before']), value: z.coerce.date() }),
	z.object({
		column: z.literal('level'),
		operator: z.enum(['in', 'notIn']),
		values: z.array(z.enum(LOG_LEVELS)).min(1),
	}),
	z.object({
		column: z.literal('source'),
		operator: z.enum(['in', 'notIn']),
		values: z.array(z.enum(LOG_SOURCES)).min(1),
	}),
	z
		.object({
			column: z.enum(INSTANCE_LOG_TEXT_COLUMNS),
			operator: z.enum(INSTANCE_LOG_TEXT_OPERATORS),
			value: z.string().max(500).default(''),
		})
		.refine((filter) => VALUELESS_TEXT_OPERATORS.has(filter.operator) || filter.value.length > 0, {
			message: 'Text filters need a value',
		}),
]);
export type InstanceLogFilter = z.infer<typeof instanceLogFilterSchema>;

export interface PaginationInput {
	limit: number;
	offset: number;
}

export interface SearchPaginationInput extends PaginationInput {
	search?: string;
}

export interface ProjectPaginationInput extends SearchPaginationInput {
	orgId?: string;
}

export interface MessagePaginationInput extends PaginationInput {
	errorsOnly?: boolean;
	role?: 'assistant' | 'user';
}

export interface LogPaginationInput extends PaginationInput {
	level?: 'error' | 'warn' | 'info';
}

export interface InstanceLogsInput extends PaginationInput {
	sort: InstanceLogSortKey;
	direction: 'asc' | 'desc';
	filters: InstanceLogFilter[];
}

export interface PaginatedResult<T> {
	items: T[];
	total: number;
}

export interface OrganizationSummary {
	id: string;
	name: string;
	slug: string;
	googleAuthDomains: string[];
	hasGoogleSso: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ProjectSummary {
	id: string;
	orgId: string | null;
	orgName: string | null;
	name: string;
	type: 'local';
	hasPath: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface UserSummary {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	requiresPasswordReset: boolean;
	memoryEnabled: boolean;
	hasGithubToken: boolean;
	hasGitlabToken: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ResourceStats {
	chats: number;
	messages: number;
	errors: number;
	messages30d: number;
	errors30d: number;
	activeUsers30d: number;
}

export interface OrganizationMemberMutation {
	orgId: string;
	userId: string;
	role: OrgRole;
}

export interface ProjectMemberMutation {
	projectId: string;
	userId: string;
	role: UserRole;
}
