# nao Python SDK

Official Python SDK for the [nao](https://github.com/getnao/nao) analytics agent. Ask questions in natural language and get data insights back — programmatically.

## Installation

```bash
pip install nao-sdk
```

## Quickstart

```python
from nao_sdk import Nao

client = Nao(api_key="nao_...", base_url="https://your-nao-instance.com")

# One-shot run — returns the full answer once the agent is done.
result = client.run("How many orders were placed last month?")
print(result.text)
print(result.chat_id)  # reuse to continue the conversation
```

### Streaming

```python
for event in client.stream("What were our top 5 products by revenue?"):
    if event.type == "text":
        print(event.text, end="", flush=True)
    elif event.type == "tool":
        print(f"\n[running {event.name}]")
```

### Continuing a conversation

```python
first = client.run("How many customers do we have?")
follow_up = client.run("And how many are returning?", chat_id=first.chat_id)
```

### Picking a model

Only models activated for the project can be selected.

```python
# List the activated models
for model in client.models():
    print(model.provider, model.model_id, model.name)

# Select one — as a "provider:model-id" string, a dict, or a Model object
client.run("Summarise revenue trends", model="openai:gpt-4o")
client.run("Summarise revenue trends", model={"provider": "openai", "modelId": "gpt-4o"})
```

### Selecting a project

If your organization has multiple projects, pass `project_id` (or set it on the client).

```python
client = Nao(api_key="nao_...", project_id="<project-uuid>")
print(client.projects())
```

## Authentication

Create an organization API key from the nao app (Settings → API keys). Keys start with `nao_`.

## API

| Method                                                               | Description                                    |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| `Nao(api_key, base_url=..., project_id=..., model=..., timeout=...)` | Create a client                                |
| `client.run(prompt, *, chat_id=..., project_id=..., model=...)`      | Run and return the full response (`RunResult`) |
| `client.stream(prompt, ...)`                                         | Stream the response as `StreamEvent`s          |
| `client.models(project_id=...)`                                      | List activated models                          |
| `client.projects()`                                                  | List projects for the org                      |
