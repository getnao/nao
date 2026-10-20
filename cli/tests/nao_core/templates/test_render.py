"""Unit tests for the user template renderer (render.py)."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from nao_core.templates.render import render_template


class TestRenderTemplateToJsonFilter:
    def test_to_json_preserves_non_ascii(self, tmp_path: Path):
        rendered = _render(tmp_path, "{{ nao.data | to_json }}", data={"name": "テスト", "emoji": "🎉"})

        assert "テスト" in rendered
        assert "🎉" in rendered
        assert "\\u" not in rendered
        parsed = json.loads(rendered)
        assert parsed == {"name": "テスト", "emoji": "🎉"}

    def test_to_json_non_ascii_roundtrips(self, tmp_path: Path):
        rows = [
            {"id": 1, "city": "東京"},
            {"id": 2, "city": "서울"},
            {"id": 3, "city": "القاهرة"},
        ]

        rendered = _render(tmp_path, "{{ nao.rows | to_json(indent=2) }}", rows=rows)

        assert "東京" in rendered
        assert "서울" in rendered
        assert "القاهرة" in rendered
        assert "\\u" not in rendered
        parsed = json.loads(rendered)
        assert parsed == rows


def _render(project_path: Path, template_source: str, **nao_attributes: object) -> str:
    (project_path / "test.md.j2").write_text(template_source)
    nao = MagicMock()
    for name, value in nao_attributes.items():
        setattr(nao, name, value)

    with patch("nao_core.templates.render.create_nao_context", return_value=nao):
        output_path = render_template(
            template_path=Path("test.md.j2"),
            project_path=project_path,
            config=None,  # type: ignore[arg-type]
        )
    return output_path.read_text()
