"""Unit tests for the template engine."""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import nao_core.templates.engine as engine_module
from nao_core.config.llm import LLMConfig, LLMProvider, ProviderConfig
from nao_core.templates.engine import (
    DEFAULT_TEMPLATES_DIR,
    TemplateEngine,
    get_template_engine,
)

BEDROCK_MODEL = "anthropic.claude-3-5-sonnet-20241022-v2:0"


def _engine_with_template(tmp_path: Path, source: str, llm_config: LLMConfig | None = None) -> TemplateEngine:
    templates_dir = tmp_path / "templates"
    templates_dir.mkdir()
    (templates_dir / "test.j2").write_text(source)
    return TemplateEngine(project_path=tmp_path, llm_config=llm_config)


def _openai_llm(*, api_key: str = "sk-test", annotation_model: str = "gpt-4.1-mini") -> LLMConfig:
    return LLMConfig(
        providers=[ProviderConfig(provider=LLMProvider.OPENAI, api_key=api_key)],
        annotation_model=annotation_model,
    )


def _bedrock_llm(*, aws_region: str) -> LLMConfig:
    return LLMConfig(
        providers=[
            ProviderConfig(
                provider=LLMProvider.BEDROCK,
                access_key="AKIA_TEST",
                secret_key="SECRET_TEST",
                aws_region=aws_region,
            )
        ],
        annotation_model=BEDROCK_MODEL,
    )


def _anthropic_llm(*, base_url: str | None = None, annotation_model: str = "claude-3-5-sonnet-latest") -> LLMConfig:
    return LLMConfig(
        providers=[ProviderConfig(provider=LLMProvider.ANTHROPIC, api_key="sk-ant-test", base_url=base_url)],
        annotation_model=annotation_model,
    )


def _install_fake_anthropic(monkeypatch) -> MagicMock:
    fake_module = MagicMock()
    fake_module.Anthropic.return_value.messages.create.return_value = MagicMock(content=[MagicMock(text="summary")])
    monkeypatch.setitem(sys.modules, "anthropic", fake_module)
    return fake_module


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
            "databases/query_history.md.j2",
            "databases/ai_summary.md.j2",
        ]

        for template in expected_templates:
            assert engine.has_template(template), f"Missing template: {template}"

    def test_has_template_returns_false_for_nonexistent(self):
        """has_template returns False for non-existent templates."""
        engine = TemplateEngine()

        assert engine.has_template("nonexistent/template.j2") is False

    def test_render_basic_template(self, tmp_path: Path):
        """Engine renders a simple template correctly."""
        engine = _engine_with_template(tmp_path, "Hello, {{ name }}!")
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
        mock_db.description.return_value = None
        mock_db.row_count.return_value = 2
        mock_db.partition_columns.return_value = []
        mock_db.clustering_columns.return_value = []
        mock_db.indexes.return_value = None

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

    def test_ai_summary_uses_profiling_and_non_representative_preview(self):
        engine = TemplateEngine(llm_config=_openai_llm())
        mock_db = MagicMock()
        mock_db.columns.return_value = [{"name": "id", "type": "int64", "description": None}]
        mock_db.description.return_value = "Customer records"
        mock_db.preview.return_value = [{"id": 1}]
        profiling = {
            "computed_at": "2026-07-15T12:00:00+00:00",
            "clustering_columns": [],
            "columns": [{"name": "id", "null_count": 0, "distinct_count": 100}],
        }

        with patch.object(engine, "_generate_openai_compatible", return_value="Generated summary") as mock_generate:
            result = engine.render(
                "databases/ai_summary.md.j2",
                table_name="customers",
                dataset="main",
                db=mock_db,
                profiling=profiling,
                computed_at="2026-07-15T13:00:00+00:00",
            )

        instruction = mock_generate.call_args.args[1]
        assert "tiny, non-representative sample of up to 10 rows" in instruction
        assert "do NOT infer data quality" in instruction
        assert "Profiling statistics (JSON)" in instruction
        assert '"distinct_count": 100' in instruction
        assert "**Computed at:** `2026-07-15T13:00:00+00:00`" in result
        mock_db.preview.assert_called_once_with(limit=10)
        mock_db.profiling.assert_not_called()

    @pytest.mark.parametrize(
        "profiling",
        [None, {"computed_at": "2026-07-15T12:00:00+00:00", "clustering_columns": [], "columns": []}],
        ids=["without_profiling", "with_empty_profiling_columns"],
    )
    def test_ai_summary_skips_quality_claims(self, profiling):
        engine = TemplateEngine(llm_config=_openai_llm())
        mock_db = MagicMock()
        mock_db.columns.return_value = []
        mock_db.description.return_value = None
        mock_db.preview.return_value = []

        with patch.object(engine, "_generate_openai_compatible", return_value="Generated summary") as mock_generate:
            result = engine.render(
                "databases/ai_summary.md.j2",
                table_name="customers",
                dataset="main",
                db=mock_db,
                profiling=profiling,
            )

        instruction = mock_generate.call_args.args[1]
        assert "Skip data-quality and distribution claims entirely" in instruction
        assert "Profiling statistics (JSON)" not in instruction
        assert "# customers - AI Summary" in result
        mock_db.profiling.assert_not_called()

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

    def test_prompt_helper_requires_llm_config(self, tmp_path: Path):
        """prompt helper should raise clear error when llm config is missing."""
        engine = _engine_with_template(tmp_path, "{{ prompt('hello') }}")
        with pytest.raises(RuntimeError, match="ai_summary generation requires an `llm` config"):
            engine.render("test.j2")

    def test_prompt_helper_uses_configured_model(self, tmp_path: Path):
        """prompt helper should call provider generator with configured model."""
        engine = _engine_with_template(tmp_path, "{{ prompt('hello world') }}", _openai_llm())

        with patch.object(engine, "_generate_openai_compatible", return_value="AI output") as mock_generate:
            rendered = engine.render("test.j2")

        assert rendered == "AI output"
        mock_generate.assert_called_once_with("gpt-4.1-mini", "hello world")

    def test_prompt_helper_supports_bedrock_without_api_key(self, tmp_path: Path):
        """prompt helper should not require api_key for bedrock provider."""
        engine = _engine_with_template(tmp_path, "{{ prompt('summarize this') }}", _bedrock_llm(aws_region="us-east-1"))

        with patch.object(engine, "_generate_bedrock", return_value="Bedrock output") as mock_generate:
            rendered = engine.render("test.j2")

        assert rendered == "Bedrock output"
        mock_generate.assert_called_once_with(BEDROCK_MODEL, "summarize this")

    def test_generate_bedrock_uses_explicit_aws_credentials(self, tmp_path: Path, monkeypatch):
        """Bedrock client should use configured credentials and region when provided."""
        engine = TemplateEngine(project_path=tmp_path, llm_config=_bedrock_llm(aws_region="us-west-2"))

        fake_client = MagicMock()
        fake_client.converse.return_value = {"output": {"message": {"content": [{"text": "Bedrock summary"}]}}}
        fake_boto3 = MagicMock()
        fake_boto3.client.return_value = fake_client
        monkeypatch.setitem(sys.modules, "boto3", fake_boto3)

        rendered = engine._generate_bedrock(BEDROCK_MODEL, "summarize this")

        assert rendered == "Bedrock summary"
        fake_boto3.client.assert_called_once_with(
            "bedrock-runtime",
            region_name="us-west-2",
            aws_access_key_id="AKIA_TEST",
            aws_secret_access_key="SECRET_TEST",
        )
        fake_client.converse.assert_called_once_with(
            modelId=BEDROCK_MODEL,
            messages=[{"role": "user", "content": [{"text": "summarize this"}]}],
            inferenceConfig={"temperature": 0},
        )

    def test_generate_bedrock_rejects_partial_static_credentials(self, tmp_path: Path):
        """Providing only one of access_key/secret_key should fail with a clear error."""
        llm_config = LLMConfig(
            providers=[
                ProviderConfig(
                    provider=LLMProvider.BEDROCK,
                    api_key=None,
                    access_key="AKIA_TEST",
                    secret_key=None,
                )
            ],
            annotation_model=BEDROCK_MODEL,
        )
        engine = TemplateEngine(project_path=tmp_path, llm_config=llm_config)

        with pytest.raises(RuntimeError, match="Bedrock configuration is incomplete"):
            engine._generate_bedrock(BEDROCK_MODEL, "summarize this")

    @pytest.mark.parametrize(
        "base_url",
        ["https://custom-endpoint.example.com/anthropic/v1", None],
        ids=["forwards_base_url", "no_base_url"],
    )
    def test_generate_anthropic_client_base_url(self, tmp_path: Path, monkeypatch, base_url):
        """Anthropic client should receive the configured base_url, or None to use the default."""
        engine = TemplateEngine(project_path=tmp_path, llm_config=_anthropic_llm(base_url=base_url))
        fake_module = _install_fake_anthropic(monkeypatch)

        result = engine._generate_anthropic("claude-3-5-sonnet-latest", "summarize this")

        assert result == "summary"
        fake_module.Anthropic.assert_called_once_with(api_key="sk-ant-test", base_url=base_url)

    def test_generate_anthropic_omits_temperature(self, tmp_path: Path, monkeypatch):
        """anthropic SDK 1.x and Claude 5.x models both reject temperature, so it must not be sent."""
        engine = TemplateEngine(project_path=tmp_path, llm_config=_anthropic_llm(annotation_model="claude-sonnet-5-5"))
        fake_module = _install_fake_anthropic(monkeypatch)

        engine._generate_anthropic("claude-sonnet-5-5", "summarize this")

        fake_module.Anthropic.return_value.messages.create.assert_called_once_with(
            model="claude-sonnet-5-5",
            max_tokens=1024,
            messages=[{"role": "user", "content": "summarize this"}],
        )

    def test_prompt_helper_anthropic_with_base_url(self, tmp_path: Path):
        """prompt helper should pass through to _generate_anthropic when provider is anthropic."""
        llm_config = _anthropic_llm(base_url="https://custom-endpoint.example.com/v1")
        engine = _engine_with_template(tmp_path, "{{ prompt('hello world') }}", llm_config)

        with patch.object(engine, "_generate_anthropic", return_value="AI output") as mock_gen:
            rendered = engine.render("test.j2")

        assert rendered == "AI output"
        mock_gen.assert_called_once_with("claude-3-5-sonnet-latest", "hello world")


class TestTemplateFilters:
    """Tests for custom Jinja2 filters."""

    def test_to_json_filter_basic(self, tmp_path: Path):
        """to_json filter converts dict to JSON string."""
        engine = _engine_with_template(tmp_path, "{{ data | to_json }}")
        result = engine.render("test.j2", data={"key": "value", "num": 42})

        parsed = json.loads(result)
        assert parsed == {"key": "value", "num": 42}

    def test_to_json_filter_preserves_non_ascii(self, tmp_path: Path):
        """to_json filter preserves non-ASCII characters (e.g. Japanese, emoji)."""
        engine = _engine_with_template(tmp_path, "{{ data | to_json }}")
        result = engine.render("test.j2", data={"name": "テスト", "emoji": "🎉"})

        assert "テスト" in result
        assert "🎉" in result
        assert "\\u" not in result
        parsed = json.loads(result)
        assert parsed == {"name": "テスト", "emoji": "🎉"}

    def test_to_json_filter_non_ascii_with_indent(self, tmp_path: Path):
        """to_json filter preserves non-ASCII characters even with indentation."""
        engine = _engine_with_template(tmp_path, "{{ data | to_json(indent=2) }}")
        result = engine.render("test.j2", data={"city": "東京", "country": "日本"})

        assert "東京" in result
        assert "日本" in result
        assert "\\u" not in result

    def test_to_json_filter_with_indent(self, tmp_path: Path):
        """to_json filter supports indent parameter."""
        engine = _engine_with_template(tmp_path, "{{ data | to_json(indent=2) }}")
        result = engine.render("test.j2", data={"a": 1})

        assert "{\n" in result  # Has newlines from indentation

    def test_to_json_filter_handles_non_serializable(self, tmp_path: Path):
        """to_json filter converts non-serializable objects to strings."""
        engine = _engine_with_template(tmp_path, "{{ data | to_json }}")
        # Path objects are not JSON serializable by default
        result = engine.render("test.j2", data={"path": Path("/some/path")})

        parsed = json.loads(result)
        assert parsed["path"].replace("\\", "/").endswith("/some/path")

    def test_truncate_middle_filter_short_text(self, tmp_path: Path):
        """truncate_middle filter leaves short text unchanged."""
        engine = _engine_with_template(tmp_path, "{{ text | truncate_middle(20) }}")
        result = engine.render("test.j2", text="hello")

        assert result == "hello"

    def test_truncate_middle_filter_long_text(self, tmp_path: Path):
        """truncate_middle filter truncates long text in the middle."""
        engine = _engine_with_template(tmp_path, "{{ text | truncate_middle(10) }}")
        result = engine.render("test.j2", text="abcdefghijklmnopqrstuvwxyz")

        assert len(result) <= 10
        assert "..." in result
        assert result.startswith("abc")
        assert result.endswith("xyz")

    def test_truncate_middle_filter_default_length(self, tmp_path: Path):
        """truncate_middle filter uses default max_length of 50."""
        engine = _engine_with_template(tmp_path, "{{ text | truncate_middle }}")
        long_text = "a" * 100
        result = engine.render("test.j2", text=long_text)

        assert len(result) <= 50

    def test_truncate_middle_handles_non_string(self, tmp_path: Path):
        """truncate_middle filter handles non-string values."""
        engine = _engine_with_template(tmp_path, "{{ num | truncate_middle(10) }}")
        result = engine.render("test.j2", num=12345)

        assert result == "12345"


class TestGetTemplateEngine:
    """Tests for the get_template_engine function."""

    @pytest.fixture(autouse=True)
    def reset_cached_engine(self, monkeypatch):
        monkeypatch.setattr(engine_module, "_engine", None)
        monkeypatch.setattr(engine_module, "_engine_signature", None)

    def test_returns_engine_instance(self):
        """get_template_engine returns a TemplateEngine instance."""
        engine = get_template_engine()

        assert isinstance(engine, TemplateEngine)

    def test_caches_engine_instance(self):
        """get_template_engine returns the same instance on repeated calls."""
        engine1 = get_template_engine()
        engine2 = get_template_engine()

        assert engine1 is engine2

    def test_creates_new_engine_for_different_project_path(self, tmp_path: Path):
        """get_template_engine creates new instance when project path changes."""
        engine1 = get_template_engine(project_path=None)
        engine2 = get_template_engine(project_path=tmp_path)

        assert engine1 is not engine2
        assert engine2.project_path == tmp_path

    def test_creates_new_engine_when_llm_settings_change(self):
        """get_template_engine should invalidate cache when llm settings change."""
        llm1 = _openai_llm(api_key="k1", annotation_model="gpt-4.1-mini")
        llm2 = _openai_llm(api_key="k1", annotation_model="gpt-4.1")

        engine1 = get_template_engine(llm_config=llm1)
        engine2 = get_template_engine(llm_config=llm2)

        assert engine1 is not engine2

    def test_creates_new_engine_for_different_llm_instance(self):
        """get_template_engine should invalidate cache for different effective llm values."""
        llm1 = _openai_llm(api_key="k1", annotation_model="gpt-4.1-mini")
        llm2 = _openai_llm(api_key="k2", annotation_model="gpt-4.1-mini")

        engine1 = get_template_engine(llm_config=llm1)
        engine2 = get_template_engine(llm_config=llm2)

        assert engine1 is not engine2

    def test_reuses_engine_for_equivalent_llm_values(self):
        """get_template_engine should reuse cache for equivalent llm config values."""
        llm1 = _openai_llm(api_key="k1", annotation_model="gpt-4.1-mini")
        llm2 = _openai_llm(api_key="k1", annotation_model="gpt-4.1-mini")

        engine1 = get_template_engine(llm_config=llm1)
        engine2 = get_template_engine(llm_config=llm2)

        assert engine1 is engine2

    def test_creates_new_engine_when_bedrock_region_changes(self):
        """get_template_engine should invalidate cache when bedrock region changes."""
        llm1 = _bedrock_llm(aws_region="us-east-1")
        llm2 = _bedrock_llm(aws_region="eu-west-1")

        engine1 = get_template_engine(llm_config=llm1)
        engine2 = get_template_engine(llm_config=llm2)

        assert engine1 is not engine2


class TestDefaultTemplatesDir:
    """Tests for the DEFAULT_TEMPLATES_DIR constant."""

    def test_all_default_database_templates_present(self):
        """All expected database templates are present in defaults."""
        databases_dir = DEFAULT_TEMPLATES_DIR / "databases"

        expected_files = [
            "columns.md.j2",
            "preview.md.j2",
            "query_history.md.j2",
            "ai_summary.md.j2",
        ]

        for filename in expected_files:
            template_path = databases_dir / filename
            assert template_path.exists(), f"Missing default template: {filename}"
            assert template_path.stat().st_size > 0, f"Empty template: {filename}"
