import type { UpdatedAtFilter, UserRole } from '@nao/shared/types';
import { and, asc, desc, eq, gt, gte, lte, or, type SQL, sql } from 'drizzle-orm';

import type { AgentSettings, DBProject, DBProjectMember, NewProject, NewProjectMember } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { env } from '../env';
import type { ListProjectChatsResponse, ProjectChatsFacetKey, UserWithRole } from '../types/project';
import { HandlerError } from '../utils/error';

export const getProjectByPath = async (path: string): Promise<DBProject | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.path, path)).execute();
	return project ?? null;
};

export const getProjectById = async (id: string): Promise<DBProject | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, id)).execute();
	return project ?? null;
};

export const getProjectMemoryEnabled = async (projectId: string): Promise<boolean> => {
	const [project] = await db
		.select({ agentSettings: s.project.agentSettings })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.execute();
	return project?.agentSettings?.memoryEnabled ?? true;
};

export const setProjectMemoryEnabled = async (projectId: string, memoryEnabled: boolean): Promise<void> => {
	await updateAgentSettings(projectId, { memoryEnabled });
};

export const createProject = async (project: NewProject): Promise<DBProject> => {
	const [created] = await db.insert(s.project).values(project).returning().execute();
	return created;
};

export const getProjectMember = async (projectId: string, userId: string): Promise<DBProjectMember | null> => {
	const [member] = await db
		.select()
		.from(s.projectMember)
		.where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.userId, userId)))
		.execute();
	return member ?? null;
};

export const addProjectMember = async (member: NewProjectMember): Promise<DBProjectMember> => {
	const [created] = await db.insert(s.projectMember).values(member).returning().execute();
	return created;
};

export const removeProjectMember = async (projectId: string, userId: string): Promise<void> => {
	await db
		.delete(s.projectMember)
		.where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.userId, userId)))
		.execute();
};

export const updateProjectMemberRole = async (projectId: string, userId: string, newRole: UserRole): Promise<void> => {
	await db
		.update(s.projectMember)
		.set({ role: newRole })
		.where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.userId, userId)))
		.execute();
};

export const listUserProjects = async (userId: string): Promise<DBProject[]> => {
	const results = await db
		.select({ project: s.project })
		.from(s.projectMember)
		.innerJoin(s.project, eq(s.projectMember.projectId, s.project.id))
		.where(eq(s.projectMember.userId, userId))
		.execute();
	return results.map((r) => r.project);
};

export const getUserRoleInProject = async (
	projectId: string,
	userId: string,
): Promise<'admin' | 'user' | 'viewer' | null> => {
	const member = await getProjectMember(projectId, userId);
	return member?.role ?? null;
};

export const getAllUsersWithRoles = async (projectId: string): Promise<UserWithRole[]> => {
	const results = await db
		.select({
			id: s.user.id,
			name: s.user.name,
			email: s.user.email,
			role: s.projectMember.role,
			messagingProviderCode: s.user.messagingProviderCode,
		})
		.from(s.user)
		.innerJoin(s.projectMember, eq(s.projectMember.userId, s.user.id))
		.where(eq(s.projectMember.projectId, projectId))
		.execute();

	return results;
};

export const getDefaultProject = async (): Promise<DBProject | null> => {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}
	return getProjectByPath(projectPath);
};

export const getProjectByUserId = async (userId: string): Promise<DBProject | null> => {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const project = await getProjectByPath(projectPath);
	if (!project) {
		return null;
	}

	const userProject = await getProjectMember(project.id, userId);

	if (!userProject) {
		return null;
	}

	return project;
};

export const checkProjectHasMoreThanOneAdmin = async (projectId: string): Promise<boolean> => {
	const userWithRoles = await getAllUsersWithRoles(projectId);
	const nbAdmin = userWithRoles.filter((u) => u.role === 'admin').length;
	return nbAdmin > 1;
};

export const getAgentSettings = async (projectId: string): Promise<AgentSettings | null> => {
	const project = await getProjectById(projectId);
	return project?.agentSettings ?? null;
};

export const updateAgentSettings = async (projectId: string, settings: AgentSettings): Promise<AgentSettings> => {
	const current = (await getAgentSettings(projectId)) ?? {};
	const next: AgentSettings = {
		...current,
		...settings,
		experimental: {
			...current.experimental,
			...settings.experimental,
		},
		webSearch: {
			...current.webSearch,
			...settings.webSearch,
		},
	};
	await db.update(s.project).set({ agentSettings: next }).where(eq(s.project.id, projectId)).execute();
	return next;
};

export const getEnabledToolsAndKnownServers = async (
	projectId: string,
): Promise<{ enabledTools: string[]; knownServers: string[] }> => {
	const project = await getProjectById(projectId);
	return {
		enabledTools: project?.enabledMcpTools ?? [],
		knownServers: project?.knownMcpServers ?? [],
	};
};

export const updateEnabledToolsAndKnownServers = async (
	projectId: string,
	updater: (current: { enabledTools: string[]; knownServers: string[] }) => {
		enabledTools: string[];
		knownServers: string[];
	},
): Promise<void> => {
	const current = await getEnabledToolsAndKnownServers(projectId);
	const next = updater(current);
	await db
		.update(s.project)
		.set({ enabledMcpTools: next.enabledTools, knownMcpServers: next.knownServers })
		.where(eq(s.project.id, projectId))
		.execute();
};

export const retrieveProjectById = async (projectId: string): Promise<DBProject> => {
	const project = await getProjectById(projectId);
	if (!project) {
		throw new HandlerError('NOT_FOUND', `Project not found: ${projectId}`);
	}
	if (!project.path) {
		throw new HandlerError('BAD_REQUEST', `Project path not configured: ${projectId}`);
	}
	return project;
};

const toUtcDayStart = (isoDate: string): Date => {
	const [y, m, d] = isoDate.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
};

const toUtcDayEnd = (isoDate: string): Date => {
	const [y, m, d] = isoDate.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
};

const buildMemberJoin = (projectId: string) =>
	and(eq(s.projectMember.userId, s.user.id), eq(s.projectMember.projectId, projectId));

const feedbackExpr = <T extends number | string>(vote: 'up' | 'down', aggregate: SQL<T>) => sql<T>`
	(
	select ${aggregate}
	from ${s.messageFeedback}
	inner join ${s.chatMessage} on ${s.chatMessage.id} = ${s.messageFeedback.messageId}
	where ${s.chatMessage.chatId} = ${s.chat.id}
		and ${s.chatMessage.supersededAt} is null
		and ${s.messageFeedback.vote} = ${vote}
	)
`;

const countToolState = (state: 'output-error' | 'output-available') => sql<number>`
	(
		select count(*)
		from ${s.chatMessage}
		inner join ${s.messagePart} on ${s.messagePart.messageId} = ${s.chatMessage.id}
		where ${s.chatMessage.chatId} = ${s.chat.id}
		and ${s.chatMessage.supersededAt} is null
		and ${s.messagePart.toolState} = ${state}
	)
`;

export const listProjectChats = async (
	projectId: string,
	opts?: {
		page?: number;
		pageSize?: number;
		search?: string;
		filters?: { id: ProjectChatsFacetKey; values: string[] }[];
		updatedAtFilter?: UpdatedAtFilter;
		sorting?: { id: string; desc?: boolean }[];
	},
): Promise<ListProjectChatsResponse> => {
	const page = Math.max(0, opts?.page ?? 0);
	const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 30));
	const search = opts?.search?.trim() ?? '';
	const filters = (opts?.filters ?? []).filter((f) => f.values?.length);
	const updatedAtFilter = opts?.updatedAtFilter;
	const sorting = opts?.sorting ?? [];

	const numberOfMessagesExpr = sql<number>`
		(
			select count(*)
			from ${s.chatMessage}
			where ${s.chatMessage.chatId} = ${s.chat.id}
				and ${s.chatMessage.supersededAt} is null
		)
	`;

	const totalTokensExpr = sql<number>`
		(
			select coalesce(sum(${s.chatMessage.totalTokens}), 0)
			from ${s.chatMessage}
			where ${s.chatMessage.chatId} = ${s.chat.id}
				and ${s.chatMessage.supersededAt} is null
		)
	`;

	const downvotesExpr = feedbackExpr('down', sql<number>`count(*)`);
	const upvotesExpr = feedbackExpr('up', sql<number>`count(*)`);
	const feedbackTextExpr = feedbackExpr(
		'down',
		dbConfig.dialect === Dialect.Postgres
			? sql<string>`coalesce(string_agg(${s.messageFeedback.explanation}, ' '), '')`
			: sql<string>`coalesce(group_concat(${s.messageFeedback.explanation}, ' '), '')`,
	);

	const toolErrorCountExpr = countToolState('output-error');
	const toolAvailableCountExpr = countToolState('output-available');

	const baseWhereClauses = [eq(s.chat.projectId, projectId)];

	if (updatedAtFilter) {
		if (updatedAtFilter.mode === 'single') {
			baseWhereClauses.push(gte(s.chat.updatedAt, toUtcDayStart(updatedAtFilter.value)));
			baseWhereClauses.push(lte(s.chat.updatedAt, toUtcDayEnd(updatedAtFilter.value)));
		} else {
			baseWhereClauses.push(gte(s.chat.updatedAt, toUtcDayStart(updatedAtFilter.start)));
			baseWhereClauses.push(lte(s.chat.updatedAt, toUtcDayEnd(updatedAtFilter.end)));
		}
	}

	if (search) {
		const escaped = search.toLowerCase().replace(/[%_\\]/g, '\\$&');
		const like = `%${escaped}%`;
		baseWhereClauses.push(sql`
			(
				lower(${s.chat.title}) like ${like}
				or lower(${s.user.name}) like ${like}
				or lower(coalesce(${s.projectMember.role}, 'Former member')) like ${like}
				or CAST(${numberOfMessagesExpr} AS TEXT) like ${like}
				or CAST(${totalTokensExpr} AS TEXT) like ${like}
				or CAST(${downvotesExpr} AS TEXT) like ${like}
				or CAST(${upvotesExpr} AS TEXT) like ${like}
				or CAST(${toolErrorCountExpr} AS TEXT) like ${like}
				or CAST(${toolAvailableCountExpr} AS TEXT) like ${like}
			)
		`);
	}
	const filterWhereClauses: SQL<unknown>[] = [];
	for (const filter of filters) {
		if (filter.values.length === 0) {
			continue;
		}

		if (filter.id === 'userName') {
			const expr = or(...filter.values.map((v) => eq(s.user.name, v)));
			if (expr) {
				filterWhereClauses.push(expr);
			}
		} else if (filter.id === 'userRole') {
			const expr = or(
				...filter.values.map((v) =>
					v === 'Former member'
						? sql`${s.projectMember.role} is null`
						: eq(s.projectMember.role, v as UserRole),
				),
			);
			if (expr) {
				filterWhereClauses.push(expr);
			}
		} else if (filter.id === 'toolState') {
			const exprs: SQL<unknown>[] = [];
			for (const v of filter.values) {
				if (v === 'noToolsUsed') {
					const e = and(eq(toolErrorCountExpr, 0), eq(toolAvailableCountExpr, 0));
					if (e) {
						exprs.push(e);
					}
				} else if (v === 'toolsNoErrors') {
					const e = and(eq(toolErrorCountExpr, 0), gt(toolAvailableCountExpr, 0));
					if (e) {
						exprs.push(e);
					}
				} else if (v === 'toolsWithErrors') {
					exprs.push(gt(toolErrorCountExpr, 0));
				}
			}
			const expr = or(...exprs);
			if (expr) {
				filterWhereClauses.push(expr);
			}
		}
	}

	const baseWhere = and(...baseWhereClauses) as SQL<unknown>;
	const where = and(...baseWhereClauses, ...filterWhereClauses) as SQL<unknown>;
	const orderBy = buildProjectChatsOrderBy({
		sorting,
		numberOfMessagesExpr,
		totalTokensExpr,
		downvotesExpr,
		upvotesExpr,
		toolErrorCountExpr,
		toolAvailableCountExpr,
	});

	const projectMemberJoin = buildMemberJoin(projectId);

	const chatRows = await db
		.select({
			chatId: s.chat.id,
			updatedAt: s.chat.updatedAt,
			userId: s.user.id,
			userName: s.user.name,
			userRole: sql<UserRole | null>`coalesce(${s.projectMember.role}, 'Former member')`.as('userRole'),
			title: s.chat.title,
			numberOfMessages: numberOfMessagesExpr.as('numberOfMessages'),
			totalTokens: totalTokensExpr.as('totalTokens'),
			feedbackText: feedbackTextExpr.as('feedbackText'),
			downvotes: downvotesExpr.as('downvotes'),
			upvotes: upvotesExpr.as('upvotes'),
			toolErrorCount: toolErrorCountExpr.as('toolErrorCount'),
			toolAvailableCount: toolAvailableCountExpr.as('toolAvailableCount'),
		})
		.from(s.chat)
		.innerJoin(s.user, eq(s.chat.userId, s.user.id))
		.leftJoin(s.projectMember, projectMemberJoin)
		.where(where)
		.orderBy(...orderBy)
		.limit(pageSize)
		.offset(page * pageSize)
		.execute();

	const [{ total }] = await db
		.select({ total: sql<number>`count(*)`.as('total') })
		.from(s.chat)
		.innerJoin(s.user, eq(s.chat.userId, s.user.id))
		.leftJoin(s.projectMember, projectMemberJoin)
		.where(where)
		.execute();

	const facets = await loadProjectChatsFacets({
		projectId,
		where: baseWhere,
		toolErrorCountExpr,
		toolAvailableCountExpr,
	});

	return {
		chats: chatRows.map((row) => ({
			id: row.chatId,
			updatedAt: row.updatedAt.getTime(),
			userId: row.userId,
			userName: row.userName,
			userRole: row.userRole,
			title: row.title,
			numberOfMessages: Number(row.numberOfMessages ?? 0),
			totalTokens: Number(row.totalTokens ?? 0),
			feedbackText: row.feedbackText ?? '',
			downvotes: Number(row.downvotes ?? 0),
			upvotes: Number(row.upvotes ?? 0),
			toolErrorCount: Number(row.toolErrorCount ?? 0),
			toolAvailableCount: Number(row.toolAvailableCount ?? 0),
		})),
		total: Number(total ?? 0),
		facets,
	};
};

function buildTieredSort(
	dir: typeof asc | typeof desc,
	primaryExpr: SQL<number>,
	secondaryExpr: SQL<number>,
): SQL<unknown>[] {
	return [
		dir(sql<number>`
		CASE
			WHEN ${primaryExpr} = 0 AND ${secondaryExpr} = 0 THEN 0
			WHEN ${primaryExpr} = 0 THEN 1
			ELSE 2
		END
		`),
		dir(sql<number>`cast(${primaryExpr} as integer)`),
	];
}

function buildProjectChatsOrderBy(args: {
	sorting: { id: string; desc?: boolean }[];
	numberOfMessagesExpr: ReturnType<typeof sql<number>>;
	totalTokensExpr: ReturnType<typeof sql<number>>;
	downvotesExpr: ReturnType<typeof sql<number>>;
	upvotesExpr: ReturnType<typeof sql<number>>;
	toolErrorCountExpr: ReturnType<typeof sql<number>>;
	toolAvailableCountExpr: ReturnType<typeof sql<number>>;
}) {
	const {
		sorting,
		numberOfMessagesExpr,
		totalTokensExpr,
		downvotesExpr,
		upvotesExpr,
		toolErrorCountExpr,
		toolAvailableCountExpr,
	} = args;

	const sorters: SQL<unknown>[] = [];

	for (const srt of sorting) {
		const dir = srt.desc ? desc : asc;
		switch (srt.id) {
			case 'updatedAt':
				sorters.push(dir(s.chat.updatedAt));
				break;
			case 'userName':
				sorters.push(dir(s.user.name));
				break;
			case 'userRole':
				sorters.push(dir(sql`coalesce(${s.projectMember.role}, 'Former member')`));
				break;
			case 'title':
				sorters.push(dir(s.chat.title));
				break;
			case 'numberOfMessages':
				sorters.push(dir(numberOfMessagesExpr));
				break;
			case 'totalTokens':
				sorters.push(dir(totalTokensExpr));
				break;
			case 'feedback':
				sorters.push(...buildTieredSort(dir, downvotesExpr, upvotesExpr));
				break;
			case 'toolState':
				sorters.push(...buildTieredSort(dir, toolErrorCountExpr, toolAvailableCountExpr));
				break;
		}
	}

	return sorters.length ? [...sorters, desc(s.chat.updatedAt)] : [desc(s.chat.updatedAt)];
}

async function loadProjectChatsFacets(args: {
	projectId: string;
	where: SQL<unknown>;
	toolErrorCountExpr: ReturnType<typeof sql<number>>;
	toolAvailableCountExpr: ReturnType<typeof sql<number>>;
}): Promise<ListProjectChatsResponse['facets']> {
	const { projectId, where, toolErrorCountExpr, toolAvailableCountExpr } = args;

	const facetMemberJoin = buildMemberJoin(projectId);
	const [userNamesRows, userRolesRows, [toolStateRow]] = await Promise.all([
		db
			.select({
				userName: s.user.name,
				count: sql<number>`count(*)`.as('count'),
			})
			.from(s.chat)
			.innerJoin(s.user, eq(s.chat.userId, s.user.id))
			.leftJoin(s.projectMember, facetMemberJoin)
			.where(where)
			.groupBy(s.user.name)
			.execute(),

		db
			.select({
				userRole: sql<UserRole | null>`coalesce(${s.projectMember.role}, 'Former member')`.as('userRole'),
				count: sql<number>`count(*)`.as('count'),
			})
			.from(s.chat)
			.innerJoin(s.user, eq(s.chat.userId, s.user.id))
			.leftJoin(s.projectMember, facetMemberJoin)
			.where(where)
			.groupBy(sql`coalesce(${s.projectMember.role}, 'Former member')`)
			.execute(),

		db
			.select({
				noToolsUsed:
					sql<number>`sum(case when ${toolErrorCountExpr} = 0 and ${toolAvailableCountExpr} = 0 then 1 else 0 end)`.as(
						'noToolsUsed',
					),
				toolsNoErrors:
					sql<number>`sum(case when ${toolErrorCountExpr} = 0 and ${toolAvailableCountExpr} > 0 then 1 else 0 end)`.as(
						'toolsNoErrors',
					),
				toolsWithErrors: sql<number>`sum(case when ${toolErrorCountExpr} > 0 then 1 else 0 end)`.as(
					'toolsWithErrors',
				),
			})
			.from(s.chat)
			.innerJoin(s.user, eq(s.chat.userId, s.user.id))
			.leftJoin(s.projectMember, facetMemberJoin)
			.where(where)
			.execute(),
	]);

	return {
		userNames: userNamesRows
			.map((r) => r.userName)
			.filter((v): v is string => !!v)
			.sort((a, b) => a.localeCompare(b)),
		userRoles: userRolesRows
			.map((r) => r.userRole ?? 'Former member')
			.filter((v): v is UserRole | 'Former member' => v != null)
			.sort((a, b) => a.localeCompare(b)),
		userNameCounts: Object.fromEntries(
			userNamesRows.filter((r) => !!r.userName).map((r) => [String(r.userName), Number(r.count ?? 0)]),
		),
		userRoleCounts: Object.fromEntries(
			userRolesRows.filter((r) => !!r.userRole).map((r) => [String(r.userRole), Number(r.count ?? 0)]),
		),
		toolState: {
			noToolsUsed: Number(toolStateRow?.noToolsUsed ?? 0),
			toolsNoErrors: Number(toolStateRow?.toolsNoErrors ?? 0),
			toolsWithErrors: Number(toolStateRow?.toolsWithErrors ?? 0),
		},
	};
}
