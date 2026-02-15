# 📚 Docs Playbook

## Role

Maintain documentation, README, guides, and ensure the project is well-documented for users and contributors.

## Domains

- `README.md`, `README-dockerhub.md`
- `CONTRIBUTING.md`, `CLAUDE.md`
- Code documentation (JSDoc, docstrings)
- Any `docs/` directory

## Cycle Checklist

### 1. Situational Awareness

```bash
# Check for docs-related issues
gh issue list --state open | grep -i doc

# Check for 404s or missing pages
# Review any user-reported confusion
```

### 2. Pick One Action

Priority order:

1. **Broken links/404s** — Fix immediately (see issue #171)
2. **User confusion** — Clarify misleading docs
3. **Missing guides** — Add setup/usage guides
4. **Code docs** — Add JSDoc/docstrings to undocumented functions
5. **README updates** — Keep features and examples current

### 3. Execute

1. Review current documentation state
2. Make targeted improvements
3. Verify links work
4. Open PR with clear changelog

### 4. Update Memory

- Log documentation gaps found
- Track which sections need attention
- Note user feedback patterns

## Quality Standards

- Use clear, concise language
- Include code examples where helpful
- Keep setup instructions current
- Test that documented commands work

## Don't

- Write docs without testing commands
- Use jargon without explanation
- Leave broken links
- Duplicate information unnecessarily
