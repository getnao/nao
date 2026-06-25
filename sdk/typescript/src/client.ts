import {
	type AvailableModel,
	type Model,
	type ModelInput,
	type Project,
	type RunOptions,
	type RunResult,
	type StreamEvent,
	normalizeModel,
} from './types';

const DEFAULT_BASE_URL = 'http://localhost:5005';

export class NaoError extends Error {
	readonly statusCode?: number;

	constructor(message: string, statusCode?: number) {
		super(message);
		this.name = 'NaoError';
		this.statusCode = statusCode;
	}
}

export interface NaoOptions {
	apiKey: string;
	baseUrl?: string;
	/** Default project used when a request does not specify one. */
	projectId?: string;
	/** Default model used when a request does not specify one. */
	model?: ModelInput;
}

/**
 * A client for the nao agent.
 *
 * @example
 * const client = new Nao({ apiKey: 'nao_...' });
 * const result = await client.run('How many orders were placed last month?');
 * console.log(result.text);
 */
export class Nao {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly defaultProjectId?: string;
	private readonly defaultModel?: ModelInput;

	constructor(options: NaoOptions) {
		if (!options?.apiKey) {
			throw new Error('apiKey is required');
		}
		this.apiKey = options.apiKey;
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
		this.defaultProjectId = options.projectId;
		this.defaultModel = options.model;
	}

	/** Send a prompt and resolve with the agent's full response once complete. */
	async run(prompt: string, options: RunOptions = {}): Promise<RunResult> {
		const response = await fetch(`${this.baseUrl}/api/v1/agent`, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify(this.buildPayload(prompt, options)),
			signal: options.signal,
		});
		const data = await this.parseJson(response);
		return { chatId: data.chatId, text: data.text ?? '', model: data.model };
	}

	/** Send a prompt and yield events as the agent responds. */
	async *stream(prompt: string, options: RunOptions = {}): AsyncGenerator<StreamEvent> {
		const response = await fetch(`${this.baseUrl}/api/v1/agent/stream`, {
			method: 'POST',
			headers: { ...this.headers(), Accept: 'text/event-stream' },
			body: JSON.stringify(this.buildPayload(prompt, options)),
			signal: options.signal,
		});
		if (!response.ok || !response.body) {
			throw new NaoError(await this.errorText(response), response.status);
		}
		yield* parseSse(response.body);
	}

	/** List the models activated for a project. */
	async models(options: { projectId?: string } = {}): Promise<AvailableModel[]> {
		const projectId = options.projectId ?? this.defaultProjectId;
		const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
		const response = await fetch(`${this.baseUrl}/api/v1/models${query}`, { headers: this.headers() });
		const data = await this.parseJson(response);
		return data.models ?? [];
	}

	/** List the projects available to this API key's organization. */
	async projects(): Promise<Project[]> {
		const response = await fetch(`${this.baseUrl}/api/v1/projects`, { headers: this.headers() });
		const data = await this.parseJson(response);
		return data.projects ?? [];
	}

	private buildPayload(prompt: string, options: RunOptions): Record<string, unknown> {
		if (!prompt) {
			throw new Error('prompt must not be empty');
		}
		const model: Model | undefined = normalizeModel(options.model ?? this.defaultModel);
		const payload: Record<string, unknown> = { prompt };
		if (options.chatId) {
			payload.chatId = options.chatId;
		}
		const projectId = options.projectId ?? this.defaultProjectId;
		if (projectId) {
			payload.projectId = projectId;
		}
		if (model) {
			payload.model = model;
		}
		return payload;
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			'Content-Type': 'application/json',
		};
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async parseJson(response: Response): Promise<any> {
		if (!response.ok) {
			throw new NaoError(await this.errorText(response), response.status);
		}
		return response.json();
	}

	private async errorText(response: Response): Promise<string> {
		try {
			const body = await response.json();
			if (body && typeof body === 'object' && (body.error || body.message)) {
				return String(body.error ?? body.message);
			}
		} catch {
			// fall through to status text
		}
		return `Request failed with status ${response.status}`;
	}
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });

			let boundary = buffer.indexOf('\n\n');
			while (boundary !== -1) {
				const rawEvent = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const event = parseSseBlock(rawEvent);
				if (event) {
					yield event;
				}
				boundary = buffer.indexOf('\n\n');
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function parseSseBlock(block: string): StreamEvent | null {
	let event: string | undefined;
	let data = '';
	for (const line of block.split('\n')) {
		const trimmed = line.replace(/\r$/, '');
		if (trimmed.startsWith('event:')) {
			event = trimmed.slice('event:'.length).trim();
		} else if (trimmed.startsWith('data:')) {
			data += trimmed.slice('data:'.length).trim();
		}
	}
	if (!event) {
		return null;
	}
	let parsed: Record<string, unknown> = {};
	try {
		parsed = data ? JSON.parse(data) : {};
	} catch {
		parsed = {};
	}
	return { type: event, ...parsed } as StreamEvent;
}
