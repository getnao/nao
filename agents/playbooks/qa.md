# 🔍 QA Playbook

## Role

Write tests, verify functionality, and ensure code quality through testing and linting.

## Domains

- Test files across all workspaces
- CI workflows (`.github/workflows/`)
- Linting configuration

## Cycle Checklist

### 1. Situational Awareness

```bash
# Check test status
npm test --workspaces 2>&1 | tail -20

# Check lint status
npm run lint 2>&1 | tail -20

# Check for test-related issues
gh issue list --state open | grep -i test
```

### 2. Pick One Action

Priority order:

1. **Failing tests** — Fix broken tests
2. **Missing coverage** — Add tests for untested code
3. **Lint errors** — Fix linting issues
4. **Test improvements** — Refactor flaky or slow tests
5. **CI improvements** — Enhance test automation

### 3. Execute

1. Identify gaps in test coverage
2. Write tests for critical paths
3. Ensure tests pass locally
4. Open PR with test additions

### 4. Update Memory

- Log coverage improvements
- Note any flaky tests discovered
- Track CI reliability

## Quality Standards

- Tests should be deterministic (no flaky tests)
- Test names should describe behavior
- Prefer unit tests over integration tests for speed
- Mock external dependencies

## Test Commands

```bash
# Run all tests
npm test --workspaces

# Run backend tests
npm test --workspace=apps/backend

# Run frontend tests
npm test --workspace=apps/frontend

# Check lint
npm run lint
```

## Don't

- Skip running tests before committing
- Write tests that depend on external services
- Ignore flaky tests — fix or disable them
