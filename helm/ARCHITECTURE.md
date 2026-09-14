# nao Helm Chart — Architecture & Values Reference

This document explains how the nao Helm chart is structured, how its components interact at runtime, and provides a complete reference for every configurable value.

---

## Table of contents

- [Application architecture](#application-architecture)
- [Development architecture (docker-compose)](#development-architecture-docker-compose)
- [Docker build (multi-stage)](#docker-build-multi-stage)
- [Kubernetes resources](#kubernetes-resources)
- [Git sync initContainer](#git-sync-initcontainer)
- [Context modes](#context-modes)
- [Secret vs ConfigMap split](#secret-vs-configmap-split)
- [Complete values reference](#complete-values-reference)
  - [General](#general)
  - [Image](#image)
  - [Service account](#service-account)
  - [Application config (ConfigMap)](#application-config-configmap)
  - [Secrets](#secrets)
  - [Service](#service)
  - [Resources](#resources)
  - [Probes](#probes)
  - [Autoscaling — HPA](#autoscaling--hpa)
  - [Pod Disruption Budget](#pod-disruption-budget)
  - [Node scheduling](#node-scheduling)
  - [Persistence — local mode](#persistence--local-mode)
  - [Projects volume — api mode](#projects-volume--api-mode)
  - [PostgreSQL subchart](#postgresql-subchart)

---

## Runtime architecture

The nao Docker image bundles **two processes** managed by `supervisord`. Both run inside a single container in the same Pod.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Kubernetes Pod                                                     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  supervisord                                                  │  │
│  │                                                               │  │
│  │  ┌──────────────────────────┐  ┌───────────────────────────┐ │  │
│  │  │  Fastify / Bun           │  │  FastAPI (Python)         │ │  │
│  │  │  backend                 │  │  analytics sidecar        │ │  │
│  │  │                          │  │                           │ │  │
│  │  │  • REST API              │  │  • LLM orchestration      │ │  │
│  │  │  • tRPC                  │  │  • SQL generation         │ │  │
│  │  │  • Serves frontend SPA   │  │  • Tool execution         │ │  │
│  │  │                          │  │                           │ │  │
│  │  │  port 5005  ◄────────────┼──┼── exposed via Service    │ │  │
│  │  │                          │  │  port 8005 (internal)     │ │  │
│  │  └──────────────────────────┘  └───────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Volumes (conditional on context mode)                              │
│  ┌─────────────────────────┐    ┌──────────────────────────────┐   │
│  │  context PVC            │    │  projects PVC                │   │
│  │  mountPath: contextPath │    │  mountPath: /app/projects    │   │
│  │  (local mode)           │    │  (api mode)                  │   │
│  └─────────────────────────┘    └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
              │ port 5005
              ▼
   ┌────────────────────┐
   │  Service           │
   │  ClusterIP / LB    │
   └────────────────────┘

   ┌────────────────────────────────────────────────────────────┐
   │  PostgreSQL  (bitnami subchart, StatefulSet)               │
   │  or external DB supplied via  secrets.dbUri                │
   └────────────────────────────────────────────────────────────┘
```

| Process | Port | Visibility | Role |
|---------|------|-----------|------|
| **Fastify / Bun** | 5005 | External (Kubernetes Service) | REST API, tRPC, serves the React SPA |
| **FastAPI** | 8005 | Internal (pod-local only) | Agent execution, SQL generation, LLM tool calls |

Key runtime properties:
- `supervisord` starts as **root** (PID 1) and drops privileges to the **`nao`** user (uid/gid 1000) for child processes. The pod security context must allow root startup — see the [security context note](#general) below.
- `supervisord` automatically restarts either process on crash.
- Port **8005** is never exposed outside the pod — all external traffic enters on port **5005**.

---

## Development architecture (docker-compose)

For local development, `docker-compose.yml` runs two services:

```
┌──────────────────┐        ┌──────────────────────────┐
│  postgres        │        │  nao (from Dockerfile)   │
│  :5432           │◄───────┤  :5005                   │
│                  │ DB_URI │  Fastify + FastAPI       │
│  PostgreSQL 16   │        │  supervisord             │
└──────────────────┘        └──────────────────────────┘
```

```bash
# Start all services
npm run dev

# Or individually:
npm run dev:backend   # Fastify + Bun (port 5005)
npm run dev:frontend  # Vite + React (port 3000)
npm run dev:fastapi   # FastAPI sidecar (port 8005)
```

The `DB_URI` connects the backend to the `postgres` service by Docker network name.

---

## Docker build (multi-stage)

The Docker image is built via a **multi-stage Dockerfile** with 5 stages:

```
Stage 1: base        → Node.js 24-slim + Bun
Stage 2: deps        → npm/bun install for all workspaces
Stage 3: frontend    → Vite build of React SPA
Stage 4: python      → uv install of nao-core Python package
Stage 5: runtime     → Final image combining all artifacts
```

The runtime image includes:
- Node.js + Bun (copied from base stage)
- Python + nao-core (from python-builder)
- Backend source + node_modules (from deps)
- Frontend build output (from frontend-builder)
- Example project directory (fallback for local mode)
- `supervisord` configuration

---

## Kubernetes resources

The chart creates the following resources. Resources marked *(conditional)* are only created when the corresponding value is enabled.

| Resource | Name | Condition |
|----------|------|-----------|
| `Deployment` | `<release>-nao` | Always |
| `Service` | `<release>-nao` | Always |
| `ConfigMap` | `<release>-nao` | Always |
| `Secret` | `<release>-nao` | `existingSecret` unset |
| `ServiceAccount` | `<release>-nao` | `serviceAccount.create=true` |
| `PersistentVolumeClaim` (context) | `<release>-nao-context` | `contextSource=local` + `persistence.enabled=true` + no `existingClaim` |
| `PersistentVolumeClaim` (projects) | `<release>-nao-projects` | `contextSource=api` + `projectsPersistence.enabled=true` + no `existingClaim` |
| `HorizontalPodAutoscaler` | `<release>-nao` | `autoscaling.enabled=true` |
| `PodDisruptionBudget` | `<release>-nao` | `podDisruptionBudget.enabled=true` |
| `Pod` (helm test) | `<release>-nao-test-connection` | `helm test` only |

When `postgresql.enabled=true`, the bitnami subchart additionally creates: a `StatefulSet`, two `Services` (one headless), a `Secret`, a `ServiceAccount`, a `NetworkPolicy`, and a `PodDisruptionBudget` for the database.

### Git sync initContainer

When `contextSource=local`, `persistence.enabled=true`, and `gitSync.url` is set, a `git-sync` initContainer runs **before** the main container to automatically clone (or pull) the context repository into the PVC.

- Uses HTTPS with token authentication (`oauth2:<token>@host`) — **no SSH keys needed**
- On pod restart/crash, the initContainer automatically re-clones/pulls

---

## Context modes

nao needs a **project directory** containing a `nao_config.yaml` that describes the data sources, schemas, and LLM tools available to the agent. The chart supports three modes, selected via `config.contextSource`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  "local"                                                                 │
│  ─────────────────────────────────────────────────────────────────────── │
│  A PVC is mounted at config.contextPath (/app/project by default).       │
│  You are responsible for pre-populating that volume with a valid          │
│  nao project before the pod starts.                                       │
│                                                                           │
│  Required values:                                                         │
│    persistence.enabled: true                                              │
│    persistence.size: <size>                                               │
│                                                                           │
│  Best for: static configurations, on-prem environments.                  │
├──────────────────────────────────────────────────────────────────────────┤
│  "git"                                                                   │
│  ─────────────────────────────────────────────────────────────────────── │
│  The entrypoint clones (or pulls) a git repository into contextPath at   │
│  every pod startup. An optional cron schedule (refreshSchedule) can      │
│  periodically re-pull the repository while the pod is running.            │
│                                                                           │
│  Required values:                                                         │
│    config.contextGitUrl: <repo-url>                                       │
│    secrets.contextGitToken: <token>  ← only for private repos            │
│                                                                           │
│  Best for: version-controlled configurations, GitOps workflows.          │
├──────────────────────────────────────────────────────────────────────────┤
│  "api"                                                                   │
│  ─────────────────────────────────────────────────────────────────────── │
│  Projects are deployed dynamically after the pod is running, using       │
│  the `nao deploy` CLI command against the running instance.              │
│  Projects are stored in a writable PVC at /app/projects.                 │
│                                                                           │
│  Required values:                                                         │
│    projectsPersistence.enabled: true                                      │
│                                                                           │
│  Best for: multi-project / multi-tenant deployments, SaaS setups.        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Secret vs ConfigMap split

Environment variables are split between a `ConfigMap` (non-sensitive) and a `Secret` (sensitive). Both are injected into the container via `envFrom`.

**ConfigMap** — `helm/templates/configmap.yaml`:
- `SERVER_PORT`, `FASTAPI_PORT`, `NODE_ENV`, `MODE`, `DOCKER`
- `BETTER_AUTH_URL`
- `NAO_CONTEXT_SOURCE`, `NAO_DEFAULT_PROJECT_PATH`
- `NAO_CONTEXT_GIT_URL`, `NAO_CONTEXT_GIT_BRANCH`, `NAO_REFRESH_SCHEDULE`
- `POSTHOG_KEY`, `POSTHOG_HOST`, `POSTHOG_DISABLED`

**Secret** — `helm/templates/secret.yaml`:
- `BETTER_AUTH_SECRET`
- `DB_URI` (auto-built from subchart values when `postgresql.enabled=true`)
- All LLM provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Azure, AWS Bedrock
- `NAO_CONTEXT_GIT_TOKEN`
- SMTP credentials, OAuth client secrets (Google, GitHub)
- `NOTION_API_KEY`

> In production, manage Secret values with an external secret manager (External Secrets Operator, AWS Secrets Manager, Sealed Secrets) rather than hardcoding them in values files. Set `existingSecret` to point the deployment at such a pre-existing Secret — the chart then renders no Secret of its own and the `secrets.*` values are ignored. The pod-template checksum only tracks the chart-rendered Secret, so rotate-and-roll of an external Secret needs its own trigger (stakater/reloader, ESO templated annotations, or `kubectl rollout restart`). Env vars the chart has no key for can be injected with `extraEnv` / `extraEnvFrom`.

---

## Complete values reference

### General

| Key | Default | Description |
|-----|---------|-------------|
| `nameOverride` | `""` | Override the chart name used in resource names |
| `fullnameOverride` | `""` | Override the fully qualified resource name |
| `replicaCount` | `1` | Number of nao pod replicas. Ignored when `autoscaling.enabled=true`. |
| `imagePullSecrets` | `[]` | List of `{name: secret-name}` entries for pulling from private registries |
| `podAnnotations` | `{}` | Extra annotations added to each Pod spec |
| `podSecurityContext` | `{}` | Pod-level security context. **Do not set `runAsNonRoot: true` or `runAsUser`** — supervisord must start as root (uid 0) to drop to the `nao` user for child processes. You may set `fsGroup: 1000` if PVC write access requires it. |
| `securityContext` | `{}` | Container-level security context. **Do not set `allowPrivilegeEscalation: false` or drop capabilities** — they conflict with supervisord's privilege-dropping mechanism. |

### Image

| Key | Default | Description |
|-----|---------|-------------|
| `image.repository` | `getnao/nao` | Container image repository — the official nao image published to Docker Hub |
| `image.tag` | `""` | Image tag. Empty string defaults to `.Chart.AppVersion`. |
| `image.pullPolicy` | `IfNotPresent` | Pull policy: `Always`, `IfNotPresent`, or `Never` |

### Service account

| Key | Default | Description |
|-----|---------|-------------|
| `serviceAccount.create` | `true` | Create a dedicated `ServiceAccount` for the pod |
| `serviceAccount.annotations` | `{}` | Annotations on the `ServiceAccount` (e.g. `eks.amazonaws.com/role-arn` for IRSA) |
| `serviceAccount.name` | `""` | Override the service account name; defaults to the release fullname |

### Application config (ConfigMap)

These values are rendered into the `ConfigMap` and injected as environment variables.

| Key | Default | Env var | Description |
|-----|---------|---------|-------------|
| `config.serverPort` | `"5005"` | `SERVER_PORT` | Fastify backend listening port |
| `config.fastapiPort` | `"8005"` | `FASTAPI_PORT` | Internal FastAPI sidecar port — not exposed outside the pod |
| `config.betterAuthUrl` | `"http://localhost:5005"` | `BETTER_AUTH_URL` | **Public URL** of the app. Must match the URL users access. Used for OAuth callbacks and trusted-origin checks. |
| `config.nodeEnv` | `"production"` | `NODE_ENV` | Node.js environment |
| `config.contextSource` | `"local"` | `NAO_CONTEXT_SOURCE` | Context loading mode: `local` \| `git` \| `api` |
| `config.contextPath` | `"/app/project"` | `NAO_DEFAULT_PROJECT_PATH` | Absolute path inside the container where the nao project is mounted or cloned |
| `config.contextGitUrl` | `""` | `NAO_CONTEXT_GIT_URL` | Git repository URL (`git` mode) |
| `config.contextGitBranch` | `"main"` | `NAO_CONTEXT_GIT_BRANCH` | Branch to clone (`git` mode) |
| `config.refreshSchedule` | `""` | `NAO_REFRESH_SCHEDULE` | Cron expression for periodic git pulls, e.g. `"0 * * * *"`. Empty = disabled. |
| `config.gitSync.url` | `""` | — | HTTPS URL of the context repo (initContainer git-sync, `local` mode only) |
| `config.gitSync.branch` | `"main"` | — | Branch to sync (initContainer git-sync) |
| `config.gitSync.image` | `"alpine/git:latest"` | — | Container image for the git-sync initContainer |
| `config.posthogKey` | `""` | `POSTHOG_KEY` | PostHog project API key (optional usage analytics) |
| `config.posthogHost` | `"https://eu.i.posthog.com"` | `POSTHOG_HOST` | PostHog ingest endpoint |
| `config.posthogDisabled` | `"false"` | `POSTHOG_DISABLED` | Set to `"true"` to opt out of usage analytics entirely (recommended for on-prem deployments to prevent outbound connections to external analytics) |
| `config.openaiBaseUrl` | `""` | `OPENAI_BASE_URL` | Custom OpenAI API base URL (e.g. for proxy or self-hosted models) |
| `config.anthropicBaseUrl` | `""` | `ANTHROPIC_BASE_URL` | Custom Anthropic API base URL |
| `config.geminiBaseUrl` | `""` | `GEMINI_BASE_URL` | Custom Gemini API base URL |
| `config.mistralBaseUrl` | `""` | `MISTRAL_BASE_URL` | Custom Mistral API base URL |
| `config.openrouterBaseUrl` | `""` | `OPENROUTER_BASE_URL` | Custom OpenRouter API base URL |
| `config.ollamaBaseUrl` | `""` | `OLLAMA_BASE_URL` | Custom Ollama API base URL |

### Secrets

All values under `secrets` are stored in a Kubernetes `Secret` object. In production, inject sensitive values via an external secrets manager rather than committing them in values files.

#### Authentication

| Key | Env var | Description |
|-----|---------|-------------|
| `secrets.betterAuthSecret` | `BETTER_AUTH_SECRET` | **Required.** Signs user sessions. Generate with `openssl rand -base64 32`. Changing this value invalidates all active sessions. |

#### Database

| Key | Env var | Description |
|-----|---------|-------------|
| `secrets.dbUri` | `DB_URI` | Database connection URI. When `postgresql.enabled=true` this is built automatically from the subchart values — leave empty. Accepted formats: `postgres://user:pass@host:5432/db` or `sqlite:./db.sqlite` |

#### LLM providers — provide at least one

| Key | Env var | Description |
|-----|---------|-------------|
| `secrets.openaiApiKey` | `OPENAI_API_KEY` | OpenAI API key (`sk-...`) |
| `secrets.anthropicApiKey` | `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `secrets.azureApiKey` | `AZURE_API_KEY` | Azure OpenAI service key |
| `secrets.azureResourceName` | `AZURE_RESOURCE_NAME` | Azure OpenAI resource name (mutually exclusive with `azureOpenaiBaseUrl`) |
| `secrets.azureOpenaiBaseUrl` | `AZURE_OPENAI_BASE_URL` | Azure OpenAI base URL (mutually exclusive with `azureResourceName`) |
| `secrets.azureApiVersion` | `AZURE_API_VERSION` | Azure OpenAI API version string |
| `secrets.awsBearerTokenBedrock` | `AWS_BEARER_TOKEN_BEDROCK` | AWS Bedrock bearer token |
| `secrets.awsRegion` | `AWS_REGION` | AWS region for Bedrock (`us-east-1`, etc.) |
| `secrets.awsAccessKeyId` | `AWS_ACCESS_KEY_ID` | AWS IAM access key ID |
| `secrets.awsSecretAccessKey` | `AWS_SECRET_ACCESS_KEY` | AWS IAM secret access key |

#### Context & enterprise

| Key | Env var | Description |
|-----|---------|-------------|
| `secrets.contextGitToken` | `NAO_CONTEXT_GIT_TOKEN` | Personal access token or deploy key for cloning a private git repository (`git` mode) |
#### Email — SMTP (optional)

| Key | Env var | Description |
|-----|---------|-------------|
| `secrets.smtpHost` | `SMTP_HOST` | SMTP server hostname |
| `secrets.smtpPort` | `SMTP_PORT` | SMTP server port (typically `587` for STARTTLS, `465` for SSL) |
| `secrets.smtpSsl` | `SMTP_SSL` | `"true"` to enable SSL, `"false"` otherwise |
| `secrets.smtpMailFrom` | `SMTP_MAIL_FROM` | Sender address used for outgoing emails |
| `secrets.smtpPassword` | `SMTP_PASSWORD` | SMTP account password |

#### OAuth providers (optional)

| Key | Env var | Description |
|-----|---------|-------------|
| `secrets.googleClientId` | `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `secrets.googleClientSecret` | `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `secrets.googleAuthDomains` | `GOOGLE_AUTH_DOMAINS` | Comma-separated list of allowed Google Workspace domains |
| `secrets.githubClientId` | `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `secrets.githubClientSecret` | `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `secrets.githubAllowedUsers` | `GITHUB_ALLOWED_USERS` | Comma-separated list of GitHub usernames allowed to sign in |

#### Integrations (optional)

| Key | Env var | Description |
|-----|---------|-------------|
| `secrets.notionApiKey` | `NOTION_API_KEY` | Notion integration API key |

### Service

| Key | Default | Description |
|-----|---------|-------------|
| `service.type` | `ClusterIP` | Kubernetes Service type: `ClusterIP`, `NodePort`, or `LoadBalancer` |
| `service.port` | `80` | Port exposed on the Service |
| `service.targetPort` | `5005` | Container port the Service routes traffic to |
| `service.annotations` | `{}` | Service annotations (e.g. AWS NLB annotations) |

### Resources

| Key | Default | Description |
|-----|---------|-------------|
| `resources.requests.cpu` | `500m` | CPU request |
| `resources.requests.memory` | `512Mi` | Memory request |
| `resources.limits.cpu` | `"2"` | CPU limit |
| `resources.limits.memory` | `2Gi` | Memory limit |

The FastAPI process is the most CPU and memory intensive (LLM calls, SQL execution). Increase limits for large datasets or heavy concurrent usage.

### Probes

The nao backend does not expose a `/health` HTTP endpoint. The chart uses **TCP socket probes** on port 5005.

| Key | Default | Description |
|-----|---------|-------------|
| `livenessProbe.tcpSocket.port` | `5005` | TCP port checked by the liveness probe |
| `livenessProbe.initialDelaySeconds` | `30` | Seconds to wait before the first liveness check (allow supervisord + processes to start) |
| `livenessProbe.periodSeconds` | `15` | Interval between liveness checks |
| `livenessProbe.failureThreshold` | `3` | Consecutive failures before the pod is restarted |
| `readinessProbe.tcpSocket.port` | `5005` | TCP port checked by the readiness probe |
| `readinessProbe.initialDelaySeconds` | `15` | Seconds to wait before the first readiness check |
| `readinessProbe.periodSeconds` | `10` | Interval between readiness checks |
| `readinessProbe.failureThreshold` | `3` | Consecutive failures before the pod is removed from the Service endpoints |

### Autoscaling — HPA

| Key | Default | Description |
|-----|---------|-------------|
| `autoscaling.enabled` | `false` | Create a `HorizontalPodAutoscaler` |
| `autoscaling.minReplicas` | `1` | Minimum number of replicas |
| `autoscaling.maxReplicas` | `5` | Maximum number of replicas |
| `autoscaling.targetCPUUtilizationPercentage` | `80` | Target average CPU utilization (%) across all pods |
| `autoscaling.targetMemoryUtilizationPercentage` | `80` | Target average memory utilization (%) across all pods |

When `autoscaling.enabled=true`, the `replicaCount` value is ignored.

### Pod Disruption Budget

| Key | Default | Description |
|-----|---------|-------------|
| `podDisruptionBudget.enabled` | `false` | Create a `PodDisruptionBudget` |
| `podDisruptionBudget.minAvailable` | `1` | Minimum number of pods that must remain available during voluntary disruptions (node drains, rolling updates) |

### Node scheduling

| Key | Default | Description |
|-----|---------|-------------|
| `nodeSelector` | `{}` | Key/value node label selector — restricts pod scheduling to matching nodes |
| `tolerations` | `[]` | List of pod tolerations for tainted nodes |
| `affinity` | `{}` | Affinity / anti-affinity rules (pod or node level) |

### Persistence — local mode

Only relevant when `config.contextSource=local`. A `PersistentVolumeClaim` is created and mounted at `config.contextPath` inside the container.

| Key | Default | Description |
|-----|---------|-------------|
| `persistence.enabled` | `false` | Create and mount a PVC for the nao project context |
| `persistence.storageClass` | `""` | StorageClass name. Empty string uses the cluster default. |
| `persistence.accessMode` | `ReadWriteOnce` | PVC access mode |
| `persistence.size` | `1Gi` | PVC storage size |
| `persistence.existingClaim` | `""` | Name of an existing PVC to use instead of creating a new one |
| `persistence.annotations` | `{}` | Extra annotations on the PVC |

> You must pre-populate the PVC with a valid nao project (a directory containing `nao_config.yaml`) before the pod starts. The entrypoint will fail if the file is missing.

### Projects volume — api mode

Only relevant when `config.contextSource=api`. A `PersistentVolumeClaim` is created and mounted at `/app/projects`.

| Key | Default | Description |
|-----|---------|-------------|
| `projectsPersistence.enabled` | `false` | Create and mount a PVC for dynamically deployed projects |
| `projectsPersistence.storageClass` | `""` | StorageClass name |
| `projectsPersistence.accessMode` | `ReadWriteOnce` | PVC access mode |
| `projectsPersistence.size` | `5Gi` | PVC storage size |
| `projectsPersistence.existingClaim` | `""` | Name of an existing PVC to reuse |
| `projectsPersistence.annotations` | `{}` | Extra annotations on the PVC |

### PostgreSQL subchart

nao uses a PostgreSQL database to store chat history and user sessions. The [bitnami/postgresql](https://github.com/bitnami/charts/tree/main/bitnami/postgresql) subchart is bundled and enabled by default.

Disable it and set `secrets.dbUri` to connect to an external database instead.

> **SQLite alternative**: For lightweight or test deployments, set `postgresql.enabled=false` and `secrets.dbUri=sqlite:./db.sqlite`. SQLite requires no additional infrastructure — data is stored inside the pod (ephemeral unless a PVC is configured).

> **Docker Hub note**: Bitnami PostgreSQL images on Docker Hub are only available for older releases. If your cluster has restricted Docker Hub access or the required image tag is not available, either set `postgresql.image.tag` to a locally mirrored version, or disable the subchart and use an external PostgreSQL instance.

| Key | Default | Description |
|-----|---------|-------------|
| `postgresql.enabled` | `true` | Deploy PostgreSQL as a subchart alongside nao |
| `postgresql.auth.database` | `nao` | Database name created at init time |
| `postgresql.auth.username` | `nao` | Database user |
| `postgresql.auth.password` | `""` | Password for the nao database user — **change in production** |
| `postgresql.auth.postgresPassword` | `""` | Password for the `postgres` superuser — **change in production** |
| `postgresql.primary.persistence.enabled` | `true` | Persist PostgreSQL data to a PVC |
| `postgresql.primary.persistence.size` | `8Gi` | PostgreSQL PVC size |

When `postgresql.enabled=true`, the chart automatically constructs `DB_URI` as:

```
postgres://<username>:<password>@<release>-nao-postgresql:5432/<database>
```

For the full list of PostgreSQL subchart values, see the [bitnami/postgresql documentation](https://github.com/bitnami/charts/tree/main/bitnami/postgresql#parameters).
