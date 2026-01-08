.PHONY: lint lint-fix format

lint:
	uv run ty check
	uv run ruff check
	uv run ruff check --select I .
	uv run ruff format --check

lint-fix:
	uv run ruff check --select I . --fix
	uv run ruff format

