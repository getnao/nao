.PHONY: lint lint-fix format docs docs-push

lint:
	uv run ty check
	uv run ruff check
	uv run ruff check --select I .
	uv run ruff format --check

lint-fix:
	uv run ruff check --select I . --fix
	uv run ruff format

docs:
	uv run python ../scripts/generate-config-docs.py ../docs

docs-push:
	uv run python ../scripts/generate-config-docs.py --push

