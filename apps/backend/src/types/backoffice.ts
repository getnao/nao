/* @license Enterprise */

import type { UserRole } from '@nao/shared/types';

import type { OrgRole } from './organization';

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
