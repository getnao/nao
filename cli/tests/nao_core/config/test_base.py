import os
from unittest.mock import patch

from nao_core.config.base import NaoConfig


def test_env_var_replacement():
    """Test replacement of a environment variable."""
    with patch.dict(os.environ, {"TEST_VAR": "test_value"}):
        content = "database: ${{ env('TEST_VAR') }}"
        result = NaoConfig._process_env_vars(content)
        assert result == "database: test_value"


def test_multiple_env_vars_replacement():
    """Test replacement of multiple environment variables."""
    with patch.dict(os.environ, {"VAR1": "value1", "VAR2": "value2"}):
        content = "host: ${{ env('VAR1') }}, port: ${{ env('VAR2') }}"
        result = NaoConfig._process_env_vars(content)
        assert result == "host: value1, port: value2"


def test_missing_env_var_returns_empty_string():
    """Test that missing environment variable is replaced with empty string."""
    with patch.dict(os.environ, {}):
        content = "value: ${{ env('NONEXISTENT_VAR') }}"
        result = NaoConfig._process_env_vars(content)
        assert result == "value: "


def test_same_env_var_multiple_times():
    """Test the same environment variable used multiple times."""
    with patch.dict(os.environ, {"REPEATED": "repeated_value"}):
        content = "${{ env('REPEATED') }} and ${{ env('REPEATED') }} again"
        result = NaoConfig._process_env_vars(content)
        assert result == "repeated_value and repeated_value again"


def test_env_var_without_dollar_prefix():
    """Test replacement without $ prefix (Jinja2-style syntax)."""
    with patch.dict(os.environ, {"API_KEY": "secret123"}):
        content = "api_key: {{ env('API_KEY') }}"
        result = NaoConfig._process_env_vars(content)
        assert result == "api_key: secret123"


def test_mixed_dollar_and_no_dollar_syntax():
    """Test that both ${{ }} and {{ }} formats work together."""
    with patch.dict(os.environ, {"VAR1": "value1", "VAR2": "value2"}):
        content = "a: ${{ env('VAR1') }}, b: {{ env('VAR2') }}"
        result = NaoConfig._process_env_vars(content)
        assert result == "a: value1, b: value2"
