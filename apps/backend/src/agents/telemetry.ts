import type { TelemetrySettings } from 'ai';

/**
 * Builds AI SDK telemetry settings so a call is exported to Langfuse. Telemetry
 * is opt-in per call in AI SDK v6, so every LLM call we want traced must pass
 * these settings via `experimental_telemetry`.
 *
 * `functionId` becomes the trace/span name in Langfuse. The well-known metadata
 * keys `sessionId`, `userId`, and `tags` are surfaced natively in the Langfuse
 * UI (Sessions view, user attribution, filtering); any other metadata key is
 * recorded as a custom attribute.
 */
export function llmTelemetry(functionId: string, metadata?: TelemetrySettings['metadata']): TelemetrySettings {
	return {
		isEnabled: true,
		functionId,
		...(metadata ? { metadata } : {}),
	};
}
