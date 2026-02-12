"""Unit tests for the template engine."""

import json
from pathlib import Path
from unittest.mock import MagicMock

from nao_core.templates.engine import (
    DEFAULT_TEMPLATES_DIR,
    TemplateEngine,
    get_template_engine,
)


class TestTemplateEngine:
    """Tests for the TemplateEngine class."""

    def test_init_without_project_path(self):
        """Engine initializes with only default templates when no project path."""
        engine = TemplateEngine(project_path=None)

        assert engine.project_path is None
        assert engine.user_templates_dir is None
        assert engine.env is not None

    def test_init_with_project_path_no_templates_dir(self, tmp_path: Path):
        """Engine works when project path exists but has no templates dir."""
        engine = TemplateEngine(project_path=tmp_path)

        assert engine.project_path == tmp_path
        assert engine.user_templates_dir == tmp_path / "templates"
        # Should still work with default templates only
        assert engine.has_template("databases/columns.md.j2")

    def test_init_with_project_path_and_templates_dir(self, tmp_path: Path):
        """Engine loads user templates when templates dir exists."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()

        engine = TemplateEngine(project_path=tmp_path)

        assert engine.project_path == tmp_path
        assert engine.user_templates_dir == templates_dir

    def test_default_templates_exist(self):
        """All expected default templates exist."""
        engine = TemplateEngine()

        expected_templates = [
            "databases/columns.md.j2",
            "databases/preview.md.j2",
            "databases/description.md.j2",
        ]

        for template in expected_templates:
            assert engine.has_template(template), f"Missing template: {template}"

    def test_has_template_returns_false_for_nonexistent(self):
        """has_template returns False for non-existent templates."""
        engine = TemplateEngine()

        assert engine.has_template("nonexistent/template.j2") is False

    def test_render_basic_template(self, tmp_path: Path):
        """Engine renders a simple template correctly."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()

        # Create a simple test template
        test_template = templates_dir / "test.j2"
        test_template.write_text("Hello, {{ name }}!")

        engine = TemplateEngine(project_path=tmp_path)
        result = engine.render("test.j2", name="World")

        assert result == "Hello, World!"

    def test_render_with_default_template(self):
        """Engine renders default database templates correctly via db context."""
        engine = TemplateEngine()

        mock_db = MagicMock()
        mock_db.columns.return_value = [
            {"name": "id", "type": "int64", "nullable": False, "description": None},
            {"name": "email", "type": "string", "nullable": True, "description": "User email"},
        ]

        result = engine.render(
            "databases/columns.md.j2",
            table_name="users",
            dataset="main",
            db=mock_db,
        )

        assert "# users" in result
        assert "**Dataset:** `main`" in result
        assert "## Columns (2)" in result
        assert "- id (int64)" in result
        assert "- email (string" in result

    def test_render_preview_template(self):
        """Engine renders preview template with rows correctly via db context."""
        engine = TemplateEngine()

        mock_db = MagicMock()
        mock_db.preview.return_value = [
            {"id": 1, "amount": 100.50},
            {"id": 2, "amount": 200.75},
        ]

        result = engine.render(
            "databases/preview.md.j2",
            table_name="orders",
            dataset="sales",
            db=mock_db,
        )

        assert "# orders - Preview" in result
        assert "**Dataset:** `sales`" in result
        assert "## Rows (2)" in result
        assert '"id": 1' in result
        assert '"amount": 100.5' in result

    def test_user_override_takes_precedence(self, tmp_path: Path):
        """User templates override default templates."""
        templates_dir = tmp_path / "templates" / "databases"
        templates_dir.mkdir(parents=True)

        # Create a custom columns template
        custom_template = templates_dir / "columns.md.j2"
        custom_template.write_text("CUSTOM: {{ table_name }} has {{ column_count }} columns")

        engine = TemplateEngine(project_path=tmp_path)
        result = engine.render(
            "databases/columns.md.j2",
            table_name="my_table",
            dataset="test",
            columns=[],
            column_count=5,
        )

        assert result == "CUSTOM: my_table has 5 columns"

    def test_is_user_override_returns_true_when_override_exists(self, tmp_path: Path):
        """is_user_override returns True when user has custom template."""
        templates_dir = tmp_path / "templates" / "databases"
        templates_dir.mkdir(parents=True)
        (templates_dir / "preview.md.j2").write_text("custom")

        engine = TemplateEngine(project_path=tmp_path)

        assert engine.is_user_override("databases/preview.md.j2") is True
        assert engine.is_user_override("databases/columns.md.j2") is False

    def test_is_user_override_returns_false_without_project_path(self):
        """is_user_override returns False when no project path set."""
        engine = TemplateEngine(project_path=None)

        assert engine.is_user_override("databases/columns.md.j2") is False


class TestTemplateFilters:
    """Tests for custom Jinja2 filters."""

    def test_to_json_filter_basic(self, tmp_path: Path):
        """to_json filter converts dict to JSON string."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "test.j2").write_text("{{ data | to_json }}")

        engine = TemplateEngine(project_path=tmp_path)
        result = engine.render("test.j2", data={"key": "value", "num": 42})

        parsed = json.loads(result)
        assert parsed == {"key": "value", "num": 42}

    def test_to_json_filter_with_indent(self, tmp_path: Path):
        """to_json filter supports indent parameter."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "test.j2").write_text("{{ data | to_json(indent=2) }}")

        engine = TemplateEngine(project_path=tmp_path)
        result = engine.render("test.j2", data={"a": 1})

        assert "{\n" in result  # Has newlines from indentation

    def test_to_json_filter_handles_non_serializable(self, tmp_path: Path):
        """to_json filter converts non-serializable objects to strings."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "test.j2").write_text("{{ data | to_json }}")

        engine = TemplateEngine(project_path=tmp_path)
        # Path objects are not JSON serializable by default
        result = engine.render("test.j2", data={"path": Path("/some/path")})

        assert "/some/path" in result

    def test_truncate_middle_filter_short_text(self, tmp_path: Path):
        """truncate_middle filter leaves short text unchanged."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "test.j2").write_text("{{ text | truncate_middle(20) }}")

        engine = TemplateEngine(project_path=tmp_path)
        result = engine.render("test.j2", text="hello")

        assert result == "hello"

    def test_truncate_middle_filter_long_text(self, tmp_path: Path):
        """truncate_middle filter truncates long text in the middle."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "test.j2").write_text("{{ text | truncate_middle(10) }}")

        engine = TemplateEngine(project_path=tmp_path)
        result = engine.render("test.j2", text="abcdefghijklmnopqrstuvwxyz")

        assert len(result) <= 10
        assert "..." in result
        assert result.startswith("abc")
        assert result.endswith("xyz")

    def test_truncate_middle_filter_default_length(self, tmp_path: Path):
        """truncate_middle filter uses default max_length of 50."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "test.j2").write_text("{{ text | truncate_middle }}")

        engine = TemplateEngine(project_path=tmp_path)
        long_text = "a" * 100
        result = engine.render("test.j2", text=long_text)

        assert len(result) <= 50

    def test_truncate_middle_handles_non_string(self, tmp_path: Path):
        """truncate_middle filter handles non-string values."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "test.j2").write_text("{{ num | truncate_middle(10) }}")

        engine = TemplateEngine(project_path=tmp_path)
        result = engine.render("test.j2", num=12345)

        assert result == "12345"


class TestGetTemplateEngine:
    """Tests for the get_template_engine function."""

    def test_returns_engine_instance(self):
        """get_template_engine returns a TemplateEngine instance."""
        # Reset global state
        import nao_core.templates.engine as engine_module

        engine_module._engine = None

        engine = get_template_engine()

        assert isinstance(engine, TemplateEngine)

    def test_caches_engine_instance(self):
        """get_template_engine returns the same instance on repeated calls."""
        import nao_core.templates.engine as engine_module

        engine_module._engine = None

        engine1 = get_template_engine()
        engine2 = get_template_engine()

        assert engine1 is engine2

    def test_creates_new_engine_for_different_project_path(self, tmp_path: Path):
        """get_template_engine creates new instance when project path changes."""
        import nao_core.templates.engine as engine_module

        engine_module._engine = None

        engine1 = get_template_engine(project_path=None)
        engine2 = get_template_engine(project_path=tmp_path)

        assert engine1 is not engine2
        assert engine2.project_path == tmp_path


class TestDefaultTemplatesDir:
    """Tests for the DEFAULT_TEMPLATES_DIR constant."""

    def test_default_templates_dir_exists(self):
        """DEFAULT_TEMPLATES_DIR points to an existing directory."""
        assert DEFAULT_TEMPLATES_DIR.exists()
        assert DEFAULT_TEMPLATES_DIR.is_dir()

    def test_default_templates_dir_contains_databases(self):
        """DEFAULT_TEMPLATES_DIR contains databases subdirectory."""
        databases_dir = DEFAULT_TEMPLATES_DIR / "databases"
        assert databases_dir.exists()
        assert databases_dir.is_dir()

    def test_all_default_database_templates_present(self):
        """All expected database templates are present in defaults."""
        databases_dir = DEFAULT_TEMPLATES_DIR / "databases"

        expected_files = [
            "columns.md.j2",
            "preview.md.j2",
            "description.md.j2",
        ]

        for filename in expected_files:
            template_path = databases_dir / filename
            assert template_path.exists(), f"Missing default template: {filename}"
            assert template_path.stat().st_size > 0, f"Empty template: {filename}"
