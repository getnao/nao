---
name: manage-user-groups
description: Create and maintain a nao project's groups.yaml file.
---

# Manage user groups

Use this skill when an administrator wants to move user-group settings from the nao UI into `groups.yaml`, or edit an existing file.

## Workflow

1. Ask the administrator to open User group settings and use **Download YAML**. Every project starts with UI-managed groups; the downloaded file preserves their stable identities, memberships and settings.
2. Put the downloaded file at the project root, next to `nao_config.yaml`.
3. Edit only the keys described by the file and the project's `GROUPS_AS_CODE.md` documentation.
4. Run `nao group format`, then `nao group lint`.
5. Review semantic changes with `nao group diff`. Use `nao group diff --exit-code` in CI.
6. Commit the file and run `nao deploy`. The first valid apply switches the project permanently to code management.

Never construct the initial file from memory when the UI already contains groups. Downloading first lets nao adopt the existing database rows, preserving shares, budgets and history.

## Important behavior

- `all_users` is required. It represents every project user and cannot declare a name, email list or SSO mapping.
- `default` is optional and only supplies inherited settings.
- Every custom `id` is stable and snake_case. Changing it archives the old group and creates a new one.
- `name` is only the UI label and may change.
- `list_of_emails` never sends invitations. Unknown addresses remain pending until the user gets project access.
- Lists replace inherited lists; they are not merged.
- Removing a custom group archives it and revokes its access without deleting its records.
- Once code management has been activated, deleting `groups.yaml` is an error and does not restore UI management.
- An invalid file is rejected before its settings are applied.

## Commands

```bash
nao group format
nao group lint
nao group diff
nao group diff --ref main --exit-code
nao deploy
```

The `groups` command is an alias of `group`.
