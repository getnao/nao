from pathlib import Path

import pytest

from nao_core.commands.sync.markers import ensure_annotations_file
from nao_core.commands.sync.providers.databases.summary_guidance import (
    MAX_PROJECT_RULES_CHARS,
    MAX_TABLE_ANNOTATIONS_CHARS,
    TRUNCATION_NOTICE,
    load_project_rules,
    load_table_annotations,
    render_shared_rules,
    strip_front_matter,
)
from nao_core.commands.sync.rules_template import RulesTemplateError


class TestRenderSharedRules:
    def test_keeps_a_fenced_directive_example(self):
        source = 'Shared\n```\n{% if group("x") %}\n```\n'

        assert render_shared_rules(source) == source

    def test_rejects_directive_text_left_outside_code_fences(self):
        source = 'Shared\nUse `{% if group("x") %}` to restrict a rule.\n'

        with pytest.raises(RulesTemplateError, match="line 2"):
            render_shared_rules(source)

    def test_ignores_directive_text_inside_removed_blocks(self):
        source = '{% if group("a") %}\nUse `{% if group("x") %}` here.\n{% endif %}\nShared\n'

        assert render_shared_rules(source) == "Shared\n"


class TestLoadProjectRules:
    def test_returns_none_without_rules_file(self, tmp_path: Path):
        warnings: list[str] = []

        assert load_project_rules(tmp_path, warnings.append) is None
        assert warnings == []

    def test_returns_none_for_blank_rules(self, tmp_path: Path):
        (tmp_path / "RULES.md").write_text("\n  \n")

        assert load_project_rules(tmp_path, [].append) is None

    def test_returns_shared_rules(self, tmp_path: Path):
        (tmp_path / "RULES.md").write_text('- Shared.\n{% if group("ops") %}\n- Ops only.\n{% endif %}\n')

        assert load_project_rules(tmp_path, [].append) == "- Shared."

    def test_truncates_long_rules_with_a_warning(self, tmp_path: Path):
        (tmp_path / "RULES.md").write_text("r" * (MAX_PROJECT_RULES_CHARS + 50))
        warnings: list[str] = []

        rules = load_project_rules(tmp_path, warnings.append)

        assert rules == "r" * MAX_PROJECT_RULES_CHARS + TRUNCATION_NOTICE
        assert len(warnings) == 1
        assert "RULES.md" in warnings[0]

    def test_skips_rules_with_malformed_directives_with_a_warning(self, tmp_path: Path):
        (tmp_path / "RULES.md").write_text('- Shared.\n{% if group("ops") %}\n- Ops only.\n')
        warnings: list[str] = []

        assert load_project_rules(tmp_path, warnings.append) is None
        assert len(warnings) == 1
        assert "matching endif" in warnings[0]


class TestStripFrontMatter:
    @pytest.mark.parametrize(
        ("content", "expected"),
        [
            ("---\ntype: manual\n---\nBody\n", "Body\n"),
            ("---\r\ntype: manual\r\n---\r\nBody\r\n", "Body\r\n"),
            ("---\n---\nBody\n", "Body\n"),
            ("---\ntype: manual\n---\nKeep this.\n\n---\n\nAnd this.\n", "Keep this.\n\n---\n\nAnd this.\n"),
        ],
        ids=["standard", "crlf", "empty", "horizontal-rule-in-body"],
    )
    def test_strips_a_leading_front_matter_block(self, content: str, expected: str):
        assert strip_front_matter(content) == expected

    @pytest.mark.parametrize(
        "content",
        [
            "----\nDo not use legacy_flag.\n----\nAmounts are in cents.\n",
            "---\nNo closing delimiter.\n",
            "--- title\nBody\n---\n",
        ],
        ids=["longer-horizontal-rules", "unclosed", "text-after-opening-delimiter"],
    )
    def test_keeps_content_without_a_front_matter_block(self, content: str):
        assert strip_front_matter(content) == content


class TestLoadTableAnnotations:
    def test_returns_none_without_annotations_file(self, tmp_path: Path):
        assert load_table_annotations(tmp_path, [].append) is None

    def test_returns_none_for_the_default_annotations_file(self, tmp_path: Path):
        ensure_annotations_file(tmp_path)

        assert load_table_annotations(tmp_path, [].append) is None

    def test_strips_front_matter(self, tmp_path: Path):
        ensure_annotations_file(tmp_path)
        annotations_file = tmp_path / "annotations.md"
        annotations_file.write_text(annotations_file.read_text() + "\nstate is the current status.\n")

        assert load_table_annotations(tmp_path, [].append) == "state is the current status."

    def test_truncates_long_annotations_with_a_warning(self, tmp_path: Path):
        (tmp_path / "annotations.md").write_text("a" * (MAX_TABLE_ANNOTATIONS_CHARS + 1))
        warnings: list[str] = []

        annotations = load_table_annotations(tmp_path, warnings.append)

        assert annotations == "a" * MAX_TABLE_ANNOTATIONS_CHARS + TRUNCATION_NOTICE
        assert len(warnings) == 1
        assert "annotations.md" in warnings[0]
