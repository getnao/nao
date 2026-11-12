import { useMemo } from 'react';
import { requestModel, requestModels } from '../story-host';
import { useHostRequest } from './use-host-request';
import type { HostRequest, HostRequestResult } from './use-host-request';
import type { StoryLlmRequest, StoryModel, StoryModelRequest, StoryModelResult } from '@nao/shared/story-models';

/** A model request; `kind` defaults to "llm", the only kind today. */
export type UseModelRequest = Omit<StoryLlmRequest, 'kind'> & { kind?: 'llm' };

export interface UseModelOptions {
	enabled?: boolean;
}

export type ModelsResult = HostRequestResult<StoryModel[]>;

export type ModelResult = HostRequestResult<StoryModelResult>;

const MODELS_REQUEST: HostRequest<StoryModel[]> = { source: 'models', key: 'models', fetch: () => requestModels() };

/** The models the viewer can call in this story's project, the default chat model flagged with `isDefault`. */
export function useModels(): ModelsResult {
	return useHostRequest(MODELS_REQUEST, true);
}

/**
 * Calls a model, as the viewer and under their budget, and answers with `{ text }` (or `{ object }` when a JSON
 * `schema` is given). The same request is answered once per visit; a changed request keeps the previous answer
 * on screen while the next one runs. Every call costs: gate it with `enabled` until the viewer asks.
 */
export function useModel(request: UseModelRequest, { enabled = true }: UseModelOptions = {}): ModelResult {
	const requestKey = JSON.stringify(toModelRequest(request));
	const hostRequest = useMemo<HostRequest<StoryModelResult>>(() => {
		const modelRequest: StoryModelRequest = JSON.parse(requestKey);
		return {
			source: 'model',
			key: `model:${requestKey}`,
			fetch: (fresh) => requestModel(modelRequest, { fresh }),
			cacheForMs: Number.POSITIVE_INFINITY,
		};
	}, [requestKey]);
	return useHostRequest(hostRequest, enabled && request.prompt.trim() !== '');
}

function toModelRequest(request: UseModelRequest): StoryModelRequest {
	return { ...request, kind: 'llm' };
}
