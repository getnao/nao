import json
from pathlib import Path

import pytest

from nao_core.commands.sync.rules_template import RulesTemplateError, render_rules_for_no_group

SHARED_FIXTURES = Path(__file__).resolve().parents[5] / "apps" / "shared" / "src" / "rules-template.fixtures.json"


def _shared_fixtures() -> list[dict]:
    if not SHARED_FIXTURES.is_file():
        return []
    return json.loads(SHARED_FIXTURES.read_text(encoding="utf-8"))


@pytest.mark.skipif(not SHARED_FIXTURES.is_file(), reason="needs the monorepo checkout")
@pytest.mark.parametrize("fixture", _shared_fixtures(), ids=lambda fixture: fixture["name"])
def test_matches_backend_rendering_for_a_user_in_no_group(fixture: dict):
    if fixture["expected"] is None:
        with pytest.raises(RulesTemplateError):
            render_rules_for_no_group(fixture["source"])
    else:
        rendered = render_rules_for_no_group(fixture["source"])
        assert "".join(line.text for line in rendered) == fixture["expected"]


def test_marks_fenced_lines_and_keeps_source_line_numbers():
    source = 'Intro\n{% if group("a") %}\nsecret\n{% endif %}\n```\n{% if group("x") %}\n```\nTail\n'

    rendered = render_rules_for_no_group(source)

    assert [(line.source_line_number, line.fenced) for line in rendered] == [
        (1, False),
        (5, True),
        (6, True),
        (7, True),
        (8, False),
    ]
