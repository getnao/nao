/* @license Enterprise */

import crypto from 'node:crypto';

import { USER_ROLES } from '@nao/shared/types';
import type { FastifyReply } from 'fastify';
import { z } from 'zod/v4';

import type { App } from '../app';
import dbConfig from '../db/dbConfig';
import { env } from '../env';
import * as backofficeQueries from '../queries/backoffice.queries';
import * as eventQueries from '../queries/backoffice-events.queries';
import * as statsQueries from '../queries/backoffice-stats.queries';
import * as userQueries from '../queries/backoffice-user.queries';
import * as backofficeService from '../services/backoffice.service';
import { ORG_ROLES } from '../types/organization';
import { HandlerError } from '../utils/error';

const paginationSchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});
const searchPaginationSchema = paginationSchema.extend({ search: z.string().optional() });
const idParamsSchema = z.object({ orgId: z.string().min(1) });
const projectParamsSchema = z.object({ projectId: z.string().min(1) });
const userParamsSchema = z.object({ userId: z.string().min(1) });
const orgMemberParamsSchema = idParamsSchema.extend({ userId: z.string().min(1) });
const projectMemberParamsSchema = projectParamsSchema.extend({ userId: z.string().min(1) });

export const backofficeRoutes = async (app: App) => {
	app.addHook('onRequest', async (request, reply) => {
		if (!isAuthorized(request.headers.authorization)) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}
	});

	app.get('/health', async () => {
		const connected = await backofficeQueries.checkDatabaseConnection();
		return {
			status: connected ? 'ok' : 'degraded',
			version: env.APP_VERSION,
			commit: env.APP_COMMIT,
			buildDate: env.APP_BUILD_DATE,
			mode: 'cloud',
			database: { dialect: dbConfig.dialect, connected },
		};
	});

	app.get('/stats', async () => statsQueries.getBackofficeStats());

	app.get('/organizations', async (request, reply) => {
		const query = parse(searchPaginationSchema, request.query, reply);
		if (!query) {
			return;
		}
		return backofficeQueries.listOrganizations(query);
	});

	app.get('/organizations/:orgId', async (request, reply) => {
		const params = parse(idParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		return runService(reply, () => backofficeService.getOrganizationDetail(params.orgId));
	});

	app.patch('/organizations/:orgId', async (request, reply) => {
		const params = parse(idParamsSchema, request.params, reply);
		const body = parse(
			z.object({ name: z.string().trim().min(1).max(100).optional() }).strict(),
			request.body,
			reply,
		);
		if (!params || !body) {
			return;
		}
		return runService(reply, () => backofficeService.updateOrganization(params.orgId, body));
	});

	app.put('/organizations/:orgId/members/:userId', async (request, reply) => {
		const params = parse(orgMemberParamsSchema, request.params, reply);
		const body = parse(z.object({ role: z.enum(ORG_ROLES) }).strict(), request.body, reply);
		if (!params || !body) {
			return;
		}
		return runService(reply, () => backofficeService.putOrganizationMember(params.orgId, params.userId, body.role));
	});

	app.delete('/organizations/:orgId/members/:userId', async (request, reply) => {
		const params = parse(orgMemberParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		const result = await runService(reply, () =>
			backofficeService.removeOrganizationMember(params.orgId, params.userId),
		);
		if (result !== SERVICE_ERROR) {
			return reply.status(204).send();
		}
	});

	app.get('/projects', async (request, reply) => {
		const query = parse(
			searchPaginationSchema.extend({ orgId: z.string().min(1).optional() }),
			request.query,
			reply,
		);
		if (!query) {
			return;
		}
		return backofficeQueries.listProjects(query);
	});

	app.get('/projects/:projectId', async (request, reply) => {
		const params = parse(projectParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		return runService(reply, () => backofficeService.getProjectDetail(params.projectId));
	});

	app.get('/projects/:projectId/messages', async (request, reply) => {
		const params = parse(projectParamsSchema, request.params, reply);
		const query = parse(
			paginationSchema.extend({
				errorsOnly: z
					.enum(['true', 'false'])
					.optional()
					.transform((value) => value === 'true'),
				role: z.enum(['assistant', 'user']).optional(),
			}),
			request.query,
			reply,
		);
		if (!params || !query || !(await ensureProject(params.projectId, reply))) {
			return;
		}
		return eventQueries.listProjectMessages(params.projectId, query);
	});

	app.get('/projects/:projectId/logs', async (request, reply) => {
		const params = parse(projectParamsSchema, request.params, reply);
		const query = parse(
			paginationSchema.extend({ level: z.enum(['error', 'warn', 'info']).optional() }),
			request.query,
			reply,
		);
		if (!params || !query || !(await ensureProject(params.projectId, reply))) {
			return;
		}
		return eventQueries.listProjectLogs(params.projectId, query);
	});

	app.get('/users', async (request, reply) => {
		const query = parse(searchPaginationSchema, request.query, reply);
		if (!query) {
			return;
		}
		return userQueries.listUsers(query);
	});

	app.get('/users/:userId', async (request, reply) => {
		const params = parse(userParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		return runService(reply, () => backofficeService.getUserDetail(params.userId));
	});

	app.patch('/users/:userId', async (request, reply) => {
		const params = parse(userParamsSchema, request.params, reply);
		const body = parse(
			z
				.object({
					name: z.string().trim().min(1).max(100).optional(),
					email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
				})
				.strict(),
			request.body,
			reply,
		);
		if (!params || !body) {
			return;
		}
		return runService(reply, () => backofficeService.updateUser(params.userId, body));
	});

	app.put('/projects/:projectId/members/:userId', async (request, reply) => {
		const params = parse(projectMemberParamsSchema, request.params, reply);
		const body = parse(z.object({ role: z.enum(USER_ROLES) }).strict(), request.body, reply);
		if (!params || !body) {
			return;
		}
		return runService(reply, () => backofficeService.putProjectMember(params.projectId, params.userId, body.role));
	});

	app.delete('/projects/:projectId/members/:userId', async (request, reply) => {
		const params = parse(projectMemberParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		const result = await runService(reply, () =>
			backofficeService.removeProjectMember(params.projectId, params.userId),
		);
		if (result !== SERVICE_ERROR) {
			return reply.status(204).send();
		}
	});
};

const SERVICE_ERROR = Symbol('service-error');

async function runService<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | typeof SERVICE_ERROR> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof HandlerError) {
			reply.status(error.code).send({ error: error.message });
			return SERVICE_ERROR;
		}
		throw error;
	}
}

async function ensureProject(projectId: string, reply: FastifyReply): Promise<boolean> {
	if (await backofficeQueries.getProjectForBackoffice(projectId)) {
		return true;
	}
	reply.status(404).send({ error: 'Project not found' });
	return false;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
	const result = schema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	reply.status(400).send({ error: result.error.issues[0]?.message ?? 'Invalid request' });
	return null;
}

function isAuthorized(authorization: string | undefined): boolean {
	if (!authorization?.startsWith('Bearer ') || !env.NAO_BACKOFFICE_API_KEY) {
		return false;
	}
	const actual = Buffer.from(authorization.slice(7));
	const expected = Buffer.from(env.NAO_BACKOFFICE_API_KEY);
	return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
