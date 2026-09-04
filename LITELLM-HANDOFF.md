# LiteLLM support handoff

Resume on Monday, September 7, 2026.

## Current state

- Branch: `fix-litellm-support-1515`
- Starting commit: `5c444a05` (same commit as `main` and `origin/main` when this file was created)
- The branch is clean and has no implementation commits yet.
- Issue: [#1515 — LiteLLM support for all nao commands and features](https://github.com/getnao/nao/issues/1515)
- Priority: P2 / medium

The issue only contains a compatibility matrix, without logs or exact LiteLLM configuration. Root causes below are hypotheses until a failing request and LiteLLM response are captured.

## Reported compatibility

The issue tests `debug`, project description, simple chat, complex chat, story chat, `nao test`, and `sync`.

- GPT 5.5, Sonnet 4.6, and Opus 4.7 pass everything.
- Haiku 4.5 has partial chat support, fails `nao test`, and passes the other commands.
- MiniMax M2.5 passes everything except `nao test`.
- Qwen 3.5 122B passes everything, but `nao test` is inconsistent.
- Mistral Small 4 only passes `debug` and project description.
- Gemma 4 26B passes `debug`, project description, simple chat, and story chat; complex chat is partial; `nao test` and `sync` fail.
- Qwen 3.6 27B passes `debug`, project description, complex chat, and story chat; simple chat is partial; `nao test` and `sync` fail.

An orange check in the source image is treated here as partial or inconsistent behavior because the issue provides no legend.

## How LiteLLM is currently integrated

There is no dedicated LiteLLM adapter. LiteLLM is configured as a named OpenAI-compatible provider such as `openaiCompatible/litellm`.

Relevant paths:

- Provider configuration and model creation: `apps/backend/src/agents/providers.ts`
- Provider metadata and model capabilities: `apps/backend/src/agents/provider-meta.ts`
- YAML provider parsing: `apps/backend/src/utils/nao-config-llm.ts`
- CLI LLM configuration: `cli/nao_core/config/llm/__init__.py`
- CLI connectivity check: `cli/nao_core/commands/debug.py`
- Agent loop and tool calling: `apps/backend/src/services/agent.ts`
- Test execution and structured verification: `apps/backend/src/services/test-agent.service.ts`
- Sync and AI summaries: `cli/nao_core/commands/sync/providers/databases/provider.py`

Example configuration:

```yaml
llm:
    providers:
        - provider: openaiCompatible/litellm
          api_key: sk-litellm
          base_url: http://localhost:4000/v1
          models:
              - id: gpt-5.5
                default: true
    annotation_model: openaiCompatible/litellm:gpt-5.5

test:
    models:
        - openaiCompatible/litellm:gpt-5.5
```

Model IDs must match LiteLLM route names.

## Main hypotheses

### 1. Structured output is declared unconditionally

`createCompatibleModel()` in `apps/backend/src/agents/providers.ts` sets:

```ts
supportsStructuredOutputs: true;
```

This makes the AI SDK send structured-output schemas for every OpenAI-compatible model. Some LiteLLM routes may only support JSON mode or plain text.

`nao test` is the best case to investigate first because:

- Its agent phase uses tools.
- Its verification phase always uses `Output.object()` in `TestAgentService.runVerification()`.
- MiniMax M2.5 reportedly supports chat and sync but fails only `nao test`, which isolates structured verification more clearly than the weaker models.

This is not confirmed without the actual error response.

### 2. Passing `debug` does not prove feature compatibility

`nao debug` generally checks `GET /v1/models`. It does not probe tool calling or structured output. A model can therefore pass `debug` and still fail chat or `nao test`.

### 3. Chat depends on reliable tool calling

All chats run through a tool-loop agent. Complex chat and stories require larger, multi-step tool calls. Models that only support plain completion through LiteLLM may not be fixable in nao without either capability restrictions or better upstream model support.

### 4. Sync failures need separate evidence

Sync AI summaries use plain OpenAI-compatible completion in the CLI rather than the backend structured-output path. Failures may come from:

- a missing or incorrect `annotation_model`;
- a LiteLLM route/model-name mismatch;
- generation errors repeated across multiple tables;
- timeout or context limitations.

Do not assume the structured-output fix will also fix sync.

## Monday starting plan

1. Confirm the exact LiteLLM YAML, LiteLLM version, route names, and model parameters used for the matrix.
2. Reproduce MiniMax M2.5:
    - verify simple chat works;
    - run one minimal `nao test`;
    - capture the backend error and LiteLLM response for the verification request.
3. Determine whether the failure is caused by `response_format: json_schema`, tool calling, unsupported reasoning parameters, or malformed output.
4. Add a focused regression test before changing provider behavior.
5. Prefer the smallest evidence-backed fix:
    - make structured-output support configurable for OpenAI-compatible models; or
    - add a safe verification fallback when JSON Schema is unsupported.
6. Re-test MiniMax, Haiku, and Qwen 3.5 before addressing sync failures.
7. Reproduce one failing sync separately and capture the first failed AI-summary request.
8. Update the issue matrix with exact failure reasons, not only pass/fail icons.

Avoid trying to make models without reliable tool calling appear fully compatible. Capability detection, clear errors, and graceful degradation may be the correct outcome.

## Existing tests to extend

- `apps/backend/tests/nao-config-llm.test.ts`
- `apps/backend/tests/provider-meta.test.ts`
- `apps/backend/tests/inference-options.test.ts`
- `apps/backend/tests/test-agent.service.test.ts`
- `cli/tests/nao_core/commands/test_debug.py`
- `cli/tests/nao_core/templates/test_engine.py`

Useful verification commands:

```bash
npm run -w @nao/backend test -- tests/test-agent.service.test.ts
npm run -w @nao/backend test -- tests/provider-meta.test.ts tests/inference-options.test.ts
cd cli && uv run pytest tests/nao_core/commands/test_debug.py tests/nao_core/templates/test_engine.py
cd ../ && npm run lint
cd cli && make lint
```

## Definition of done

- The supported LiteLLM configuration is documented.
- `debug` communicates that connectivity does not guarantee tools or structured output.
- `nao test` succeeds or fails clearly according to declared model capabilities.
- Sync failures do not hide the provider/model and first generation error.
- Automated tests cover the chosen capability or fallback behavior.
- The issue matrix is re-run and updated with reproducible results.
