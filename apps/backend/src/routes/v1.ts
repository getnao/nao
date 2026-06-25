import type { ServerResponse } from 'node:http';

import { type InferUIMessageChunk, readUIMessageStream } from 'ai';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod/v4';

import type { App } from '../app';
import type { DBProject } from '../db/abstractSchema';
import { handleAgentRoute } from '../handlers/agent';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { authenticateApiKey, type AuthenticatedApiKey } from '../services/api-key.service';
import type { UIMessage, UIMessagePart } from '../types/chat';
import { llmSelectedModelSchema } from '../types/llm';
import { HandlerError } from '../utils/error';
import { getProjectAvailableModels } from '../utils/llm';

const SdkAgentRequestSchema = z.object({
	prompt: z.string().min(1),
	chatId: z.string().optional(),
	projectId: z.string().optional(),
	model: llmSelectedModelSchema.optional(),
});

type SdkAgentRequest = z.infer<typeof SdkAgentRequestSchema>;

/**
 * Public, programmatic REST API consumed by the nao SDKs (Python & TypeScript).
 * Authenticated with an organization API key (`Authorization: Bearer nao_...`).
 */
export const v1Routes = async (app: App) => {
	app.post('/agent', { schema: { body: SdkAgentRequestSchema } }, async (request, reply) => {
		const { auth, project, body } = await prepareAgentRun(request);
		const result = await handleAgentRoute({
			userId: auth.userId,
			projectId: project.id,
			message: { text: body.prompt },
			chatId: body.chatId,
			model: body.model,
		});

		const text = await collectFinalText(result.stream);
		return reply.send({ chatId: result.chatId, text, model: result.model });
	});

	app.post('/agent/stream', { schema: { body: SdkAgentRequestSchema } }, async (request, reply) => {
		const { auth, project, body } = await prepareAgentRun(request);
		const result = await handleAgentRoute({
			userId: auth.userId,
			projectId: project.id,
			message: { text: body.prompt },
			chatId: body.chatId,
			model: body.model,
		});

		startSse(reply);
		const raw = reply.raw;
		writeSse(raw, 'message_start', { chatId: result.chatId, model: result.model });

		try {
			let lastText = '';
			const seenTools = new Set<string>();
			for await (const message of readUIMessageStream<UIMessage>({ stream: result.stream })) {
				emitToolEvents(raw, message.parts, seenTools);
				const text = extractText(message);
				const delta = diffText(lastText, text);
				if (delta) {
					writeSse(raw, 'text', { text: delta });
				}
				lastText = text;
			}
			writeSse(raw, 'message_complete', { chatId: result.chatId, text: lastText, model: result.model });
		} catch (err) {
			writeSse(raw, 'error', { error: errorMessage(err) });
		} finally {
			raw.end();
		}
	});

	app.get('/models', async (request, reply) => {
		const auth = await authenticate(request);
		const project = await resolveProject(auth, { projectId: queryParam(request, 'projectId') }, request.headers);
		const models = await getProjectAvailableModels(project.id);
		return reply.send({ models });
	});

	app.get('/projects', async (request, reply) => {
		const auth = await authenticate(request);
		const projects = await projectQueries.listProjectsByOrg(auth.org.id);
		return reply.send({ projects: projects.map((p) => ({ id: p.id, name: p.name })) });
	});
};

async function prepareAgentRun(
	request: FastifyRequest,
): Promise<{ auth: AuthenticatedApiKey; project: DBProject; body: SdkAgentRequest }> {
	const auth = await authenticate(request);
	const body = request.body as SdkAgentRequest;
	const project = await resolveProject(auth, { chatId: body.chatId, projectId: body.projectId }, request.headers);
	return { auth, project, body };
}

async function authenticate(request: FastifyRequest): Promise<AuthenticatedApiKey> {
	const header = request.headers.authorization;
	if (!header?.startsWith('Bearer ')) {
		throw new HandlerError(
			'UNAUTHORIZED',
			'Missing or invalid Authorization header. Provide your API key as `Authorization: Bearer nao_...`.',
		);
	}

	const auth = await authenticateApiKey(header.slice(7));
	if (!auth) {
		throw new HandlerError('UNAUTHORIZED', 'Invalid API key.');
	}
	return auth;
}

async function resolveProject(
	auth: AuthenticatedApiKey,
	opts: { chatId?: string; projectId?: string },
	headers: FastifyRequest['headers'],
): Promise<DBProject> {
	if (opts.chatId) {
		const projectId = await chatQueries.getChatProjectId(opts.chatId);
		if (!projectId) {
			throw new HandlerError('NOT_FOUND', `Chat with id ${opts.chatId} not found.`);
		}
		return assertProjectInOrg(await projectQueries.getProjectById(projectId), auth);
	}

	const explicitId = opts.projectId ?? headerProjectId(headers);
	if (explicitId) {
		return assertProjectInOrg(await projectQueries.getProjectById(explicitId), auth);
	}

	const project = await projectQueries.getFirstProjectByOrg(auth.org.id);
	if (!project) {
		throw new HandlerError('BAD_REQUEST', 'No project found for this organization.');
	}
	return project;
}

function assertProjectInOrg(project: DBProject | null, auth: AuthenticatedApiKey): DBProject {
	if (!project || project.orgId !== auth.org.id) {
		throw new HandlerError('NOT_FOUND', 'Project not found for this organization.');
	}
	return project;
}

function headerProjectId(headers: FastifyRequest['headers']): string | undefined {
	const value = headers['x-nao-project-id'];
	return Array.isArray(value) ? value[0] : value;
}

function queryParam(request: FastifyRequest, key: string): string | undefined {
	const query = request.query as Record<string, string | string[] | undefined>;
	const value = query?.[key];
	return Array.isArray(value) ? value[0] : value;
}

async function collectFinalText(stream: ReadableStream<InferUIMessageChunk<UIMessage>>): Promise<string> {
	let lastMessage: UIMessage | null = null;
	for await (const message of readUIMessageStream<UIMessage>({ stream })) {
		lastMessage = message;
	}
	return lastMessage ? extractText(lastMessage) : '';
}

function extractText(message: UIMessage): string {
	return message.parts
		.filter((p): p is Extract<UIMessagePart, { type: 'text' }> => p.type === 'text')
		.map((p) => p.text)
		.join('\n\n');
}

/** Return the appended suffix when `next` extends `prev`, otherwise the full new text. */
function diffText(prev: string, next: string): string {
	if (next === prev) {
		return '';
	}
	return next.startsWith(prev) ? next.slice(prev.length) : next;
}

function emitToolEvents(raw: ServerResponse, parts: UIMessagePart[], seen: Set<string>): void {
	for (const part of parts) {
		if (!isToolPart(part) || seen.has(part.toolCallId)) {
			continue;
		}
		if (part.state !== 'input-available' && part.state !== 'output-available') {
			continue;
		}
		seen.add(part.toolCallId);
		writeSse(raw, 'tool', { name: part.type.replace(/^tool-/, ''), status: 'running' });
	}
}

function isToolPart(part: UIMessagePart): part is Extract<UIMessagePart, { toolCallId: string; state: string }> {
	return typeof part.type === 'string' && part.type.startsWith('tool-') && 'toolCallId' in part && 'state' in part;
}

function startSse(reply: FastifyReply): void {
	reply.raw.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	reply.hijack();
}

function writeSse(raw: ServerResponse, event: string, data: unknown): void {
	raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : 'Unknown error';
}
