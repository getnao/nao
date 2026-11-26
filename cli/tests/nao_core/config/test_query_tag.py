"""The `query_tag` section of nao_config.yaml: the comment nao adds to the SQL it sends to a warehouse."""

from pathlib import Path

import pytest

from nao_core.config.base import NaoConfig, NaoConfigError
from nao_core.config.query_tag import QueryTagPosition

CORE = "project_name: test-project\n"


def load(tmp_path: Path, query_tag: str) -> NaoConfig | None:
    (tmp_path / "nao_config.yaml").write_text(CORE + query_tag)
    return NaoConfig.try_load(tmp_path, raise_on_error=True)


def test_placeholders_are_kept_for_the_app_to_fill(tmp_path: Path):
    config = load(tmp_path, 'query_tag:\n  template: "nao: user={{ user_email }}, source={{ source }}"\n')

    assert config is not None and config.query_tag is not None
    assert config.query_tag.template == "nao: user={{ user_email }}, source={{ source }}"
    assert config.query_tag.position is QueryTagPosition.START


@pytest.mark.parametrize(
    "query_tag",
    [
        "query_tag:\n  template: nao\n  position: middle\n",
        "query_tag:\n  template: ''\n",
        "query_tag:\n  position: end\n",
    ],
)
def test_invalid_tags_are_rejected(tmp_path: Path, query_tag: str):
    with pytest.raises(NaoConfigError):
        load(tmp_path, query_tag)
