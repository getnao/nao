# nao Helm Chart

Helm chart for deploying nao — an open-source analytics agent that transforms natural language into SQL queries — on Kubernetes.

## Prerequisites

- (Optional) A running PostgreSQL instance, or enable the bundled bitnami/postgresql subchart

## Chart structure

```
helm/
├── Chart.yaml                        # Chart metadata & bitnami/postgresql dependency
├── values.yaml                       # Default configuration values
├── .helmignore
└── templates/
    ├── NOTES.txt                     # Post-install instructions
    ├── _helpers.tpl                  # Template helpers
    ├── configmap.yaml                # Non-sensitive environment variables
    ├── secret.yaml                   # Sensitive values (API keys, auth secret, DB URI)
    ├── serviceaccount.yaml
    ├── deployment.yaml               # Main nao workload
    ├── service.yaml
    ├── pvc.yaml                      # Conditional (local / api context modes)
    ├── hpa.yaml                      # Conditional
    ├── pdb.yaml                      # Conditional
    └── tests/
        └── test-connection.yaml      # helm test pod
```

## Installation

### 1. Add the bitnami repository (for the PostgreSQL dependency)

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### 2. Install dependencies

```bash
helm dependency update ./helm
```

### 3. Install the chart

```bash
helm install nao ./helm \
  --namespace nao --create-namespace \
  --set secrets.betterAuthSecret="$(openssl rand -base64 32)" \
  --set secrets.openaiApiKey="" \
```

## Context modes

nao supports three ways to load its project configuration, controlled by `config.contextSource`.

### `local` (default)

The nao project directory is mounted as a Kubernetes PersistentVolume.

```yaml
# values-local.yaml
config:
  contextSource: local
  contextPath: /app/project

persistence:
  enabled: true
  size: 1Gi
  # existingClaim: my-nao-context-pvc  # use an existing PVC
```

> **Note:** You must pre-populate the PVC with a valid nao project (a directory containing `nao_config.yaml`).

### `git`

The project is cloned from a Git repository at pod startup.

```yaml
# values-git.yaml
config:
  contextSource: git
  contextPath: /app/project
  contextGitUrl: https://github.com/your-org/your-nao-project.git
  contextGitBranch: main
  refreshSchedule: "0 * * * *"   # optional: pull every hour

secrets:
  contextGitToken: ghp_...        # required for private repositories
```

### `api`

Projects are deployed dynamically via the `nao deploy` CLI. A writable volume is created at `/app/projects`.

```yaml
# values-api.yaml
config:
  contextSource: api

projectsPersistence:
  enabled: true
  size: 5Gi
```

## Values reference

| Key | Default | Description |
|-----|---------|-------------|
| `replicaCount` | `1` | Number of pod replicas |
| `image.repository` | `ghcr.io/getnao/nao` | Container image repository |
| `image.tag` | `""` (→ appVersion) | Image tag |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy |
| `config.serverPort` | `"5005"` | Fastify backend listening port |
| `config.betterAuthUrl` | `"http://localhost:5005"` | Public URL for auth callbacks |
| `config.contextSource` | `"local"` | Context mode: `local` \| `git` \| `api` |
| `config.contextPath` | `"/app/project"` | Mount path for the nao project |
| `config.contextGitUrl` | `""` | Git repo URL (git mode) |
| `config.contextGitBranch` | `"main"` | Git branch to clone (git mode) |
| `config.refreshSchedule` | `""` | Cron for periodic git pull |
| `secrets.betterAuthSecret` | `""` | **Required.** Auth session secret |
| `secrets.openaiApiKey` | `""` | OpenAI API key |
| `secrets.anthropicApiKey` | `""` | Anthropic API key |
| `secrets.dbUri` | `""` | Database URI (overridden when `postgresql.enabled=true`) |
| `secrets.contextGitToken` | `""` | Git token for private repos |
| `secrets.contextGitToken` | `""` | Git token for private repos |
| `service.type` | `ClusterIP` | Kubernetes service type |
| `service.port` | `80` | Service port |
| `resources.requests.cpu` | `500m` | CPU request |
| `resources.requests.memory` | `512Mi` | Memory request |
| `resources.limits.cpu` | `2` | CPU limit |
| `resources.limits.memory` | `2Gi` | Memory limit |
| `autoscaling.enabled` | `false` | Enable HPA |
| `autoscaling.minReplicas` | `1` | Minimum replicas |
| `autoscaling.maxReplicas` | `5` | Maximum replicas |
| `podDisruptionBudget.enabled` | `false` | Enable PDB |
| `persistence.enabled` | `false` | Enable context PVC (local mode) |
| `persistence.size` | `1Gi` | Context PVC size |
| `persistence.existingClaim` | `""` | Use an existing PVC |
| `projectsPersistence.enabled` | `false` | Enable projects PVC (api mode) |
| `projectsPersistence.size` | `5Gi` | Projects PVC size |
| `postgresql.enabled` | `true` | Deploy bundled PostgreSQL |
| `postgresql.auth.database` | `nao` | PostgreSQL database name |
| `postgresql.auth.username` | `nao` | PostgreSQL username |
| `postgresql.auth.password` | `""` | PostgreSQL password (**change in production**) |

For the full list of values and their descriptions, see [`values.yaml`](./values.yaml).

## Using an external database

Set `postgresql.enabled=false` and provide a connection URI:

```yaml
postgresql:
  enabled: false

secrets:
  dbUri: "postgres://user:password@my-postgres-host:5432/nao"
```

SQLite is also supported for single-node / testing deployments:

```yaml
postgresql:
  enabled: false

secrets:
  dbUri: "sqlite:./db.sqlite"
```

## Upgrade

```bash
helm upgrade nao ./helm --namespace nao -f my-values.yaml
```

## Rollback

```bash
# List revision history
helm history nao --namespace nao

# Roll back to a previous revision
helm rollback nao <revision> --namespace nao
```

## Running chart tests

```bash
helm test nao --namespace nao
```

## Uninstall

```bash
helm uninstall nao --namespace nao
```

> **Note:** PersistentVolumeClaims are not deleted automatically. Remove them manually if no longer needed:
> ```bash
> kubectl delete pvc -l app.kubernetes.io/instance=nao --namespace nao
> ```
