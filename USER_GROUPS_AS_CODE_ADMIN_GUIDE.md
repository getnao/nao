# Managing nao user groups as code

Code-managed user groups make `user_groups.yaml` the source of truth for a project's groups, memberships, and group-level access settings. This is useful when administrators want reviewed, repeatable access changes.

## Before you enable it

You need:

- Project administrator access.
- A license that includes User Groups. Budgets and row-level security also require their respective licensed features.
- A deployed nao project containing `user_groups.yaml` at its root, beside `nao_config.yaml`.
- Environment-based OIDC and Microsoft group mappings removed.

Enabling makes group settings read-only in the nao UI. SSO can still create or sign in project users, but only this file assigns them to groups. Existing per-group SSO mappings are suspended and do not automatically resume if you later return to UI management.

Do not put passwords, API keys, tokens, or other secrets in this file.

## Start from current groups

In **Settings → Users & Groups**, select **Download YAML**. Add the downloaded `user_groups.yaml` to the project root, deploy it with `nao deploy`, then select **Preview code management**. Review the calculated changes before confirming.

After code management is enabled, normal deploys reconcile the file. Preview a deploy without changing files or groups:

```shell
nao deploy https://your-nao.example --api-key "$NAO_API_KEY" --dry-run
```

An invalid deploy changes neither the deployed context nor group state. A code-managed deploy also fails if the file is absent or the API key creator is no longer a project admin.

## Complete version 1 example

`defaults` is required and must contain every setting. `all_users` and custom groups may override individual complete fields. Lists replace inherited lists; they are not merged.

<!-- validated-example:start -->

```yaml
version: 1

defaults:
    features: []
    tool_call_density:
        default_density: detailed
        can_change: true
    show_all_settings: false
    project_sharing: inherit
    share_targets:
        include_own_group: true
        group_keys: []
    preloaded_skills: []
    budget_limit_usd: null
    database_access:
        mode: all
        strict: true
    docs_access:
        mode: all
    files_access:
        mode: all
    mcp_access:
        mode: all
    skills_access:
        mode: all
    row_policies:
        version: 1
        policies: []

all_users:
    features: [storyCreation]

groups:
    - key: finance
      name: Finance
      members:
          - analyst@example.com
          - finance-lead@example.com
      project_sharing: allowed
      share_targets:
          include_own_group: true
          group_keys: [leadership]
      budget_limit_usd: 100
      database_access:
          mode: restricted
          strict: true
          grants:
              - kind: schema
                database_type: postgres
                database: warehouse
                schema: finance
          patterns: []
      row_policies:
          version: 1
          policies:
              - database_type: postgres
                database: warehouse
                schema: finance
                table: invoices
                access: predicate
                mode: guided
                combinator: and
                conditions:
                    - column: region
                      operator: equals
                      value: EMEA

    - key: leadership
      name: Leadership
      members: [ceo@example.com]
      show_all_settings: true
```

<!-- validated-example:end -->

The example demonstrates all inheritance rules and common controls. Replace catalog names and emails with values from your project.

## Field reference

Top-level fields:

- `version`: required; currently `1`.
- `defaults`: required, complete settings object.
- `all_users`: required object whose fields are optional overrides. Its identity and membership remain system-managed.
- `groups`: required list, up to 10,000 entries.

Each custom group requires:

- `key`: stable identifier, 1–80 characters, matching `^[a-z][a-z0-9_-]*$`. Never change it for a rename.
- `name`: unique active display name, 1–80 characters.
- `members`: explicit desired email list, up to 100,000 valid email addresses. Emails are normalized to lowercase.

Every setting below is required in `defaults` and optional as a whole-field override in `all_users` or a custom group:

- `features`: unique values from `storyCreation`, `customStoryCreation`, and `automationCreation`.
- `tool_call_density`: `default_density` is `compact` or `detailed`; `can_change` is a boolean.
- `show_all_settings`: boolean.
- `project_sharing`: `inherit`, `allowed`, or `blocked`.
- `share_targets`: `include_own_group` plus `group_keys`, which may reference existing custom-group keys but not the owning group's key.
- `preloaded_skills`: up to the configured preloaded-skill limit; every name must exist in the project.
- `budget_limit_usd`: non-negative number or `null` for no group-specific limit.
- `database_access`: either `{mode: all, strict: boolean}` or restricted access with `strict`, `grants`, and `patterns`. A grant is a `schema` or `table` and names its `database_type`, `database`, `schema`, and, for table grants, `table`.
- `docs_access` and `files_access`: either `{mode: all}` or `{mode: restricted, grants: [...]}`. Each grant has `kind: folder|file` and a project-relative `path`.
- `mcp_access`: either `{mode: all}` or restricted `grants`. A grant selects a `server` or a `tool` with its server and tool names.
- `skills_access`: either `{mode: all}` or `{mode: restricted, skills: [...]}`.
- `row_policies`: `version: 1` and a `policies` list. Each policy identifies a registered table with `database_type`, `database`, `schema`, and `table`.

A row policy uses one of:

- `access: full`.
- Guided predicate access: `access: predicate`, `mode: guided`, `combinator: and|or`, and 1–100 conditions. Operators are `equals`, `does-not-equal`, comparisons, `is-one-of`, `is-not-one-of`, `is-null`, and `is-not-null`.
- SQL predicate access: `access: predicate`, `mode: sql`, and a `predicate` beginning with `WHERE`.

Names, catalog references, predicates, sharing targets, and licensed settings are validated before any state changes.

## Common operations

Rename a group by changing only `name`; its stable `key` preserves identity. Removing an email deactivates that membership without deleting its history. Removing a group entry archives it and revokes its active access. Restoring the same key reactivates the same group; using a new key creates a different group.

An unknown member email is kept as a pending assignment. It activates when exactly one project user later has that email and project access. YAML never sends invitations. Removing project access prevents runtime access even while the desired email remains in the file.

`All Users` always includes every project user. Declare only its editable settings under `all_users`; never list members for it.

Sharing targets use stable keys:

```yaml
share_targets:
    include_own_group: false
    group_keys: [finance, leadership]
```

Restricted docs access replaces the inherited field:

```yaml
docs_access:
    mode: restricted
    grants:
        - kind: folder
          path: policies
```

## Returning to UI management

In **Settings → Users & Groups**, select **Return to UI management** and confirm. nao preserves active groups, settings, and resolved memberships, then makes them editable. Pending assignments are deactivated. Suspended SSO group mappings stay suspended and must be explicitly configured again. The deployed file remains present but is ignored until code management is enabled again.

If the license expires, the last reconciled configuration and runtime mode are preserved. New changes that require an unavailable licensed feature are rejected rather than silently weakening access.
