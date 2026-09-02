from nao_core.commands.test.case import TestCase as NaoTestCase
from nao_core.commands.test.case import discover_tests


def test_discover_tests_is_recursive(tmp_path):
    (tmp_path / "tests" / "revenue").mkdir(parents=True)
    (tmp_path / "tests" / "revenue" / "mrr.yml").write_text("prompt: how much mrr\n")
    (tmp_path / "tests" / "ops" / "sla").mkdir(parents=True)
    (tmp_path / "tests" / "ops" / "sla" / "uptime.yaml").write_text("prompt: uptime\n")

    cases = discover_tests(tmp_path)

    names = {c.name for c in cases}
    assert names == {"mrr", "uptime"}


def test_from_yaml_reads_the_database_field(tmp_path):
    test_file = tmp_path / "revenue.yml"
    test_file.write_text("prompt: total revenue\nsql: select 1\ndatabase: bigquery-prod\n")

    case = NaoTestCase.from_yaml(test_file)

    assert case.database == "bigquery-prod"


def test_from_yaml_leaves_database_unset_when_absent(tmp_path):
    test_file = tmp_path / "revenue.yml"
    test_file.write_text("prompt: total revenue\nsql: select 1\n")

    case = NaoTestCase.from_yaml(test_file)

    assert case.database is None


def test_discover_tests_ignores_outputs_dir(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "real.yml").write_text("prompt: real\n")
    (tmp_path / "tests" / "outputs").mkdir()
    (tmp_path / "tests" / "outputs" / "results.yml").write_text("prompt: not a test\n")

    cases = discover_tests(tmp_path)

    assert {c.name for c in cases} == {"real"}
