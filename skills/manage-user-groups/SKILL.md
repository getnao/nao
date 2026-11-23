---
name: manage-user-groups
description: Create or edit `groups.yaml`, the file that manages a nao project's user groups as code — members, SSO group mapping, features, sharing, MCP and skill access, database and file access, and row-level security policies. Use when the user wants to define who can see which tables, schemas, docs, files, MCP tools or skills, map Okta / OIDC / Microsoft Entra ID groups to nao groups, restrict a team to its own data, add row policies, move user groups from the UI to code, or fix `nao group lint` errors. Creating the first `groups.yaml` requires the user's explicit approval. Do not use for warehouse connection setup (use `setup-context`) or CI deploys (use `deploy-context`).
---

# manage-user-groups

`groups.yaml` sits at the project root, next to `nao_config.yaml`. Once nao loads a valid file, the file becomes the source of truth for user groups: everything it defines is read-only in the UI. Changes go live on `nao deploy`, or on the next server restart for projects mounted or synced without `nao deploy`.

## The agent prepares, a human applies

Writing and linting `groups.yaml` changes nothing on the server. Applying it does, and the first time it is applied the project switches to code management. That switch is the user's decision, so this skill stops after `nao group lint`:

- **Never run `nao deploy`, restart the server, or push to a branch that auto-deploys** as part of this skill. Hand the file over and let the user ship it.
- **Never write `groups.yaml` into a folder a running server reads** (a mounted or synced project folder). Its next restart would apply the file. Work in the Git checkout.

## Creating the first `groups.yaml` needs explicit approval

If the project has no `groups.yaml`, its groups are managed in the UI. **Do not create the file unless the user explicitly asked to manage user groups as code.** A request like "give finance access to the revenue schema" is not that request: answer that groups are managed in the UI today, point to **Settings → Project → User groups**, and offer the move to code as an option.

Before writing the first file, explain what applying it will do and wait for the user to confirm they want it:

- **The project switches to code management.** There is no UI toggle to go back.
- **Custom groups that exist in the UI but are missing from the file are archived** and lose their access. Records are kept, but the members lose what the group granted them.
- **A missing or invalid file then blocks.** The server refuses to start (nao Cloud skips the project and keeps its last state), and `nao deploy` rejects the upload. Recovery is restoring the file from Git.

Without a clear yes, stop. Once confirmed, and if the project already has groups in the UI, ask the user for the export from **Settings → Project → User groups → Download YAML** and edit it instead of writing from scratch. The export already contains every existing group, so nothing is archived by accident.

When `groups.yaml` already exists, the project is already code-managed, and editing the file at the user's request needs no extra approval.

## Workflow

```
- [ ] 0. No groups.yaml yet? Get explicit approval to move to code management
- [ ] 1. Collect the access matrix from the user
- [ ] 2. Inventory what exists in the project
- [ ] 3. Write or edit groups.yaml
- [ ] 4. nao group format, then nao group lint, until clean
- [ ] 5. Hand over to the user, who ships it
```

### 1. Collect the access matrix

Ask in one round, and never invent emails, SSO group names, or Entra group IDs:

1. Which groups, and who belongs to each: emails, SSO groups, or both.
2. What every project user should get by default (`all_users`).
3. Per group: which databases, schemas, tables, docs and files; which MCP servers or tools; which skills.
4. Any row-level restriction, for example "sales_emea only sees `region = 'EMEA'`".
5. Who can share with whom, and which features (stories, automations) each group gets.

### 2. Inventory the project

Every reference is checked against the project folder, so read the real values instead of guessing:

| YAML field                                     | Where the valid values come from                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database_type`, `database`, `schema`, `table` | Folder names under `databases/type=<t>/database=<d>/schema=<s>/table=<t>/` (lowercase `database_type`). Run `nao sync` first if `databases/` is missing. |
| `access.files[].path`                          | Paths relative to the project root, such as `docs/finance` or `semantics/revenue.yaml`. Never under `databases/`.                                        |
| `capabilities.mcp.grants[].server` / `.tool`   | `agent/mcps/<server>/` and `agent/mcps/<server>/<tool>.json`.                                                                                            |
| `capabilities.skills.allowed` / `.preloaded`   | `agent/skills/*.md`: the frontmatter `name`, or the filename without `.md`.                                                                              |
| `share_targets.group_ids`                      | Ids of custom groups in the same file.                                                                                                                   |

### 3. Write the file

File shape:

```yaml
groups:
    - id: default # optional, values every other group inherits; no members
    - id: all_users # required, every project user is a member
    - id: finance # custom group
      name: Finance
      list_of_emails: [alice@example.com]
      sso_groups: { oidc: [okta-finance] }
      capabilities: {}
      access: {}
      policies: {}
```

Rules the agent cannot infer:

- **Keys and enum values are snake_case** (`story_creation`, `is_one_of`). Group ids match `^[a-z][a-z0-9_]*$`. Changing an id archives the old group and creates a new one, so rename with `name`, not `id`.
- **`all_users` is required.** `default` and `all_users` cannot declare `name`, `list_of_emails` or `sso_groups`.
- **`name`** is optional, defaults to the id, must be unique, and cannot be `All Users`.
- **Inheritance**: nao's hidden defaults, then `default`, then the group. Each leaf (`capabilities.skills`, `access.files`, `policies.rows`, ...) **replaces** the inherited value as a whole. Lists are never merged, so a group that overrides `access.databases` must restate everything it needs.
- **Hidden defaults are closed**: no features, no MCP, no skills, no databases, no files. A group with no settings sees nothing beyond what `all_users` grants.
- **Membership is a union** of `list_of_emails` and users whose SSO groups match `sso_groups` at login. An email with no project user yet stays pending. The file never sends invitations.
- **Docs are files**: grant `docs/...` under `access.files`. A `docs` folder grant opens every doc.
- **`policies.columns` must stay `[]`**, and leave `protected_tables` and `budget` out. Both are reserved and still managed in the UI.

#### `capabilities`

```yaml
capabilities:
    features: [story_creation, custom_story_creation, automation_creation] # any subset
    tool_call_density: { default_density: detailed, can_change: true } # compact | detailed
    show_all_settings: false
    advanced_context_explorer: false
    project_sharing: inherit # inherit | allowed | blocked
    share_targets: { include_own_group: true, group_ids: [leadership] } # cannot include itself
    mcp:
        mode: restricted # or `mode: all` with no other key
        grants:
            - { kind: server, server: github }
            - { kind: tool, server: slack, tool: post_message }
    skills:
        mode: restricted # or `mode: all`, which still accepts `preloaded`
        allowed: [revenue_analysis]
        preloaded: [revenue_analysis] # must also be in allowed when restricted, max 50
```

#### `access`

```yaml
access:
    databases:
        mode: restricted # or `mode: all`
        strict: true # block SQL on tables outside the user's combined group access
        grants:
            - { kind: schema, database_type: postgres, database: warehouse, schema: finance }
            - { kind: table, database_type: snowflake, database: analytics, schema: core, table: customers }
        patterns: [finance_*, core.revenue_*] # no dot: schema glob; schema.table glob
    files:
        mode: restricted # or `mode: all`
        grants:
            - { kind: folder, path: docs/finance }
            - { kind: file, path: semantics/revenue.yaml }
```

#### `policies.rows`

Each entry targets one table, which must already be registered in the **Row security** settings. Guided conditions may only use that table's constraint columns.

```yaml
policies:
    rows:
        - database_type: postgres
          database: warehouse
          schema: finance
          table: invoices
          access: predicate
          mode: guided
          combinator: and # and | or
          conditions: # 1 to 100
              - { column: region, operator: is_one_of, values: [EMEA, APAC] } # values cannot contain commas
              - { column: amount, operator: less_than, value: 10000 }
              - { column: deleted_at, operator: is_null } # no value
        - {
              database_type: postgres,
              database: warehouse,
              schema: finance,
              table: payments,
              access: predicate,
              mode: sql,
              predicate: WHERE amount < 10000,
          }
        - { database_type: postgres, database: warehouse, schema: finance, table: budgets, access: full }
    columns: []
```

Operators: `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal` take `value`. `is_one_of` and `is_not_one_of` take `values`. `is_null` and `is_not_null` take neither. SQL predicates must start with `WHERE`.

#### `sso_groups`

```yaml
sso_groups:
    oidc: [okta-finance] # group names sent in the OIDC groups claim
    microsoft: [6f1c2e4a-0b7d-4c1e-9a3f-2d5b8e7c1a90] # Entra ID group object IDs, not display names
    default_project_role: user # admin | user | viewer | context_admin, for users provisioned through these groups
```

If the deployment sets `OIDC_GROUP_NAO_GROUP_MAPPING` or `AZURE_AD_GROUP_NAO_GROUP_MAPPING`, tell the user to remove them: the server rejects the file while they are set.

### 4. Format and lint

Run from the project root and loop until both pass:

```bash
nao group format # rewrites key order and fixes camelCase values, old keys (key, members, docs_access), a leftover version
nao group lint   # schema, ids, inheritance, and every reference against the local project
```

`lint` runs offline. These checks only run on the server, at deploy or startup, so mention them to the user when they apply:

- A **user groups license** is required. Row policies, and restricted MCP or skill access with at least one grant, need an **Enterprise** license.
- Row policies need their table registered in **Row security**, and guided conditions need its constraint columns.

### 5. Hand over

Stop here and give the user:

- A summary of each group: members, access, and policies.
- The custom groups that will be archived, when editing an export or an existing file.
- The server-only checks from step 4 that apply.
- How it goes live, for them to run: `nao deploy` applies it without a restart; projects mounted or synced without `nao deploy` pick it up on the next restart. Afterwards, **Settings → Project → User groups** shows the groups as read-only.
- A reminder to commit `groups.yaml` to Git. It is the only way back from a bad change.

## Guardrails

- **Least privilege.** Keep `all_users` narrow, because it applies to everyone. Grant wide access through custom groups.
- **Prefer `strict: true`** on groups that hold sensitive grants, so SQL cannot reach tables outside the group's access.
- **Never delete `groups.yaml`** from a code-managed project. It does not fall back to UI management, it blocks the project.
- **Check the archive list before shipping.** When editing an export, compare the group ids with the UI. Every id missing from the file is archived.
- **Don't widen access on a guess.** If the user's request is ambiguous ("finance sees finance data"), confirm the exact schemas or tables before writing `mode: all`.
