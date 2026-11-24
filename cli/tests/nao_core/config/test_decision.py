"""The `decision` section of nao_config.yaml: the System 1 models the chat app can ask."""

from pathlib import Path

import pytest

from nao_core.config.base import NaoConfig, NaoConfigError
from nao_core.config.decision import DecisionProvider

CORE = "project_name: test-project\n"


def load(tmp_path: Path, decision: str) -> NaoConfig | None:
    (tmp_path / "nao_config.yaml").write_text(CORE + decision)
    return NaoConfig.try_load(tmp_path, raise_on_error=True)


def test_providers_are_read_under_the_names_the_app_accepts(tmp_path: Path):
    config = load(
        tmp_path,
        "decision:\n"
        "  model: typesafe/jev-latest\n"
        "  providers:\n"
        "    - provider: jev\n"
        "      api_key: ts-key\n"
        "    - provider: openai\n"
        "    - provider: cloudflare\n"
        "      api_key: cf-token\n"
        "      account_id: acc-1\n"
        "    - provider: system-one\n"
        "      base_url: https://decisions.example.com\n",
    )

    assert config is not None and config.decision is not None
    assert [provider.provider for provider in config.decision.providers] == [
        DecisionProvider.TYPESAFE,
        DecisionProvider.OPENAI,
        DecisionProvider.CLOUDFLARE,
        DecisionProvider.SYSTEM_ONE,
    ]
    assert config.decision.providers[1].api_key is None
    assert config.decision.providers[2].account_id == "acc-1"
    assert config.decision.model == "typesafe/jev-latest"


def test_the_block_survives_a_save(tmp_path: Path):
    config = load(
        tmp_path, "decision:\n  providers:\n    - provider: system_one\n      base_url: http://localhost:9000\n"
    )
    assert config is not None

    config.save(tmp_path)
    reloaded = NaoConfig.try_load(tmp_path, raise_on_error=True)

    assert reloaded is not None and reloaded.decision is not None
    assert reloaded.decision.providers[0].provider is DecisionProvider.SYSTEM_ONE
    assert reloaded.decision.providers[0].base_url == "http://localhost:9000"


@pytest.mark.parametrize(
    "decision",
    [
        "decision:\n  providers:\n    - provider: gpt\n",
        "decision:\n  providers:\n    - provider: systemOne\n",
        "decision:\n  providers:\n    - provider: openai\n    - provider: openai\n",
        "decision:\n  model: jev-latest\n",
        "decision:\n  model: gpt/jev-latest\n",
    ],
)
def test_invalid_blocks_are_rejected(tmp_path: Path, decision: str):
    with pytest.raises(NaoConfigError):
        load(tmp_path, decision)
