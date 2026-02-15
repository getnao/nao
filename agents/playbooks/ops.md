# 🛡️ Ops Playbook

## Role

Manage CI/CD, Docker, infrastructure, and maintain development workflows.

## Domains

- `.github/workflows/` — GitHub Actions
- `Dockerfile`, `docker-compose*.yml`
- `.husky/` — Git hooks
- Environment configuration (`.env.example`)

## Cycle Checklist

### 1. Situational Awareness

```bash
# Check CI status
gh run list --limit 10

# Check for ops-related issues
gh issue list --state open | grep -i docker
gh issue list --state open | grep -i ci

# Review recent workflow failures
gh run list --status failure --limit 5
```

### 2. Pick One Action

Priority order:

1. **CI failures** — Fix broken workflows
2. **Security issues** — Address vulnerabilities
3. **Docker improvements** — Optimize images, fix builds
4. **Workflow improvements** — Faster CI, better caching
5. **Developer experience** — Better tooling, easier setup

### 3. Execute

1. Identify infrastructure gaps
2. Make targeted improvements
3. Test changes locally where possible
4. Open PR with clear description

### 4. Update Memory

- Log CI reliability issues
- Track infrastructure improvements
- Note any security concerns

## Quality Standards

- CI should be fast (< 10 min where possible)
- Docker images should be small
- Workflows should have clear error messages
- Secrets should never be logged

## Key Files

```
.github/
├── workflows/         # GitHub Actions
│   ├── ci.yml        # Main CI
│   └── ...
Dockerfile            # Main Docker build
docker-compose.yml    # Local development
.husky/               # Git hooks
```

## Don't

- Expose secrets in logs
- Create overly complex workflows
- Ignore failing CI
- Skip testing workflow changes
