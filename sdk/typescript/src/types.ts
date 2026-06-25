/** A model selection: a provider (e.g. `openai`) and a model id. */
export interface Model {
	provider: string;
	modelId: string;
}

/** A model that is activated for a project and can be selected. */
export interface AvailableModel {
	provider: string;
	modelId: string;
	name: string;
}

export interface Project {
	id: string;
	name: string;
}

/** A model passed by the caller: a `Model` object or a `"provider:model-id"` string. */
export type ModelInput = Model | string;

export interface RunOptions {
	/** Continue an existing conversation by id. */
	chatId?: string;
	/** Override the project for this request. */
	projectId?: string;
	/** Pick a model (must be activated for the project). */
	model?: ModelInput;
	/** Abort the request. */
	signal?: AbortSignal;
}

/** The result of a non-streaming agent run. */
export interface RunResult {
	chatId: string;
	text: string;
	model?: Model;
}

export type StreamEvent =
	| { type: 'message_start'; chatId: string; model?: Model }
	| { type: 'text'; text: string }
	| { type: 'tool'; name: string; status: string }
	| { type: 'message_complete'; chatId: string; text: string; model?: Model }
	| { type: 'error'; error: string };

export function normalizeModel(model: ModelInput | undefined): Model | undefined {
	if (model === undefined) {
		return undefined;
	}
	if (typeof model === 'string') {
		const separator = model.includes(':') ? ':' : model.includes('/') ? '/' : null;
		if (!separator) {
			throw new Error("model string must look like 'provider:model-id' (e.g. 'openai:gpt-4o')");
		}
		const [provider, modelId] = model.split(separator);
		return { provider: provider.trim(), modelId: modelId.trim() };
	}
	if (!model.provider || !model.modelId) {
		throw new Error("model must contain 'provider' and 'modelId'");
	}
	return { provider: model.provider, modelId: model.modelId };
}
