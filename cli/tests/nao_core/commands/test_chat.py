from pathlib import Path

from nao_core.config.base import NaoConfig


def test_returns_none_when_nao_config_file_does_not_exist(tmp_path: Path):
    missing_file = tmp_path / "missing.yaml"
    cfg = NaoConfig.try_load(missing_file)

    assert cfg is None


def test_returns_config_when_nao_config_file_is_valid(tmp_path: Path):
    valid_yaml = tmp_path / "nao_config.yaml"
    valid_yaml.write_text(
        """
        project_name: nao
        """
    )
    cfg = NaoConfig.try_load(tmp_path)

    assert cfg is not None
    assert isinstance(cfg, NaoConfig)
