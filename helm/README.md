# nao Helm Chart

Helm chart for deploying nao — an open-source agent to do analytics on your data with AI — on Kubernetes.

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

Chart versions are published to GHCR on `helm-v*` tags, see [Releasing the chart](#releasing-the-chart). `--version` is the **chart** semver (`Chart.yaml` `version`); the nao image tag comes from `appVersion` (override with `--set image.tag=` if needed):

```bash
helm install nao oci://ghcr.io/getnao/nao/charts/nao --version 0.1.0 \
  --namespace nao --create-namespace \
  --set secrets.betterAuthSecret="$(openssl rand -base64 32)"
```

### From this repository

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm dependency update ./helm

helm install nao ./helm \
  --namespace nao --create-namespace \
  --set secrets.betterAuthSecret="$(openssl rand -base64 32)" \
  --set secrets.openaiApiKey=""
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
| `image.repository` | `getnao/nao` | Container image repository |
| `image.tag` | `""` (→ appVersion) | Image tag |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy |
| `config.serverPort` | `"5005"` | Fastify backend listening port |
| `config.betterAuthUrl` | `"http://localhost:5005"` | Public URL for auth callbacks |
| `config.contextSource` | `"local"` | Context mode: `local` \| `git` \| `api` |
| `config.contextPath` | `"/app/project"` | Mount path for the nao project |
| `config.contextGitUrl` | `""` | Git repo URL (git mode) |
| `config.contextGitBranch` | `"main"` | Git branch to clone (git mode) |
| `config.refreshSchedule` | `""` | Cron for periodic git pull |
| `config.dbSsl` | `false` | Require TLS on the database connection |
| `config.enableUserLogin` | `true` | Email/password login |
| `config.enableUserSignup` | `false` | Allow self sign-up |
| `config.defaultUserRole` | `"user"` | Role for new users: `admin` \| `user` \| `viewer` |
| `config.githubSso` | `false` | Enable "Sign in with GitHub" |
| `config.gitlabSso` | `false` | Enable "Sign in with GitLab" |
| `config.gitlabBaseUrl` | `""` | Self-hosted GitLab instance URL |
| `config.betaAutomationsEnabled` | `true` | Recurring prompt automations |
| `config.betaContextRecommendationsEnabled` | `false` | Context recommendations |
| `existingSecret` | `""` | Load all secret env vars from a pre-existing Secret instead of rendering one (the `secrets.*` block is then ignored). Rotations of that Secret need an external rollout trigger |
| `extraEnv` | `[]` | Extra env vars appended verbatim to the nao container |
| `extraEnvFrom` | `[]` | Extra `envFrom` sources appended after the chart's ConfigMap/Secret |
| `secrets.betterAuthSecret` | `""` | **Required.** Auth session secret |
| `secrets.openaiApiKey` | `""` | OpenAI API key |
| `secrets.anthropicApiKey` | `""` | Anthropic API key |
| `secrets.naoLicense` | `""` | Enterprise license — required for SSO providers |
| `secrets.redisUrl` | `""` | Redis connection string |
| `secrets.gitlabClientId` | `""` | GitLab OAuth app client ID |
| `secrets.azureAdClientId` | `""` | Microsoft / Azure AD SSO client ID |
| `secrets.oidcClientId` | `""` | Generic OIDC SSO client ID (Okta, Auth0, Keycloak, …) |
| `secrets.dbUri` | `""` | Database URI (overridden when `postgresql.enabled=true`) |
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

## Releasing the chart

The `Helm` workflow packages the chart and pushes it to `oci://ghcr.io/getnao/nao/charts`. The chart releases on its own cadence — nao's `v*` release tags do not publish it.

`Chart.yaml` is the only source of truth: `version` is the chart semver and `appVersion` is the nao image tag. Both are set by a commit, never by CI, so every published chart maps to a reviewable commit. The workflow refuses to publish a `version` that already exists in GHCR.

To release:

1. In `helm/Chart.yaml`, bump `version`. Also update `appVersion` if the chart should point at a newer nao image.
2. Commit and merge.
3. Tag and push:

```bash
git tag helm-v0.1.1
git push origin helm-v0.1.1
```

The tag must match `version` in `Chart.yaml` or the job fails. A manual run (workflow dispatch) publishes the committed `Chart.yaml` as-is, which is useful for retrying a failed push.

Users who want a nao image other than the one in `appVersion` do not need a chart release — they can set `image.tag`.

## Uninstall

```bash
helm uninstall nao --namespace nao
```

> **Note:** PersistentVolumeClaims are not deleted automatically. Remove them manually if no longer needed:
> ```bash
> kubectl delete pvc -l app.kubernetes.io/instance=nao --namespace nao
> ```
