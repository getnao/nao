/** OpenTelemetry tracer names whose spans the OTLP exporter sends. Other spans, such as LLM calls, only reach Langfuse. */
export const REQUEST_TRACER_NAME = 'nao-http';
export const EFFECT_TRACER_NAME = 'nao-effect';
