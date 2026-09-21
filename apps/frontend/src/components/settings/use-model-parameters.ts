import { useEffect, useMemo, useRef, useState } from 'react';
import { getModelParameterSpec } from '@nao/backend/provider-meta';
import { buildInferenceSettings, getParamErrors, seedParamValues } from './model-parameters-fields';
import type { ParamValues } from './model-parameters-fields';
import type { ModelInferenceSettings, ParamKey } from '@nao/backend/llm';
import type { LlmProvider } from '@nao/shared/types';

interface UseModelParametersArgs {
	provider: LlmProvider;
	modelId: string;
	open: boolean;
	value: ModelInferenceSettings | undefined;
}

/**
 * Shared state for dialogs that edit a model's inference parameters: derives the
 * control spec, seeds draft values when the dialog transitions to open (never on
 * later prop identity changes, so in-progress edits survive parent re-renders),
 * and exposes validation plus the settings builder for saving.
 */
export function useModelParameters({ provider, modelId, open, value }: UseModelParametersArgs) {
	const controls = useMemo(() => (modelId ? getModelParameterSpec(provider, modelId) : []), [provider, modelId]);
	const [values, setValues] = useState<ParamValues>({});
	const wasOpenRef = useRef(false);

	useEffect(() => {
		const justOpened = open && !wasOpenRef.current;
		wasOpenRef.current = open;
		if (justOpened) {
			setValues(seedParamValues(controls, value));
		}
	}, [open, controls, value]);

	const errors = getParamErrors(controls, values);
	const hasErrors = Object.keys(errors).length > 0;

	const setValue = (key: ParamKey, next: string) => setValues((prev) => ({ ...prev, [key]: next }));
	const buildSettings = () => buildInferenceSettings(controls, values);

	return { controls, values, setValue, errors, hasErrors, buildSettings };
}
