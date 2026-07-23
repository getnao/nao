from nao_core.commands.test.case import discover_tests


def test_discover_tests_is_recursive(tmp_path):
    (tmp_path / "tests" / "revenue").mkdir(parents=True)
    (tmp_path / "tests" / "revenue" / "mrr.yml").write_text("prompt: how much mrr\n")
    (tmp_path / "tests" / "ops" / "sla").mkdir(parents=True)
    (tmp_path / "tests" / "ops" / "sla" / "uptime.yaml").write_text("prompt: uptime\n")

    cases = discover_tests(tmp_path)

    names = {c.name for c in cases}
    assert names == {"mrr", "uptime"}


def test_discover_tests_ignores_outputs_dir(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "real.yml").write_text("prompt: real\n")
    (tmp_path / "tests" / "outputs").mkdir()
    (tmp_path / "tests" / "outputs" / "results.yml").write_text("prompt: not a test\n")

    cases = discover_tests(tmp_path)

    assert {c.name for c in cases} == {"real"}
