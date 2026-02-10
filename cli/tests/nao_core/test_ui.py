"""Unit tests for the UI module."""

from unittest.mock import MagicMock, patch

import pytest

from nao_core.ui import UI, ask_confirm, ask_select, ask_text


class TestUI:
    """Tests for UI helper class."""

    def test_success_prints_green_check(self):
        """UI.success prints message with green checkmark."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.success("Operation completed")

        mock_console.print.assert_called_once()
        call_arg = mock_console.print.call_args[0][0]
        assert "✓" in call_arg
        assert "Operation completed" in call_arg
        assert "green" in call_arg

    def test_warn_prints_yellow_text(self):
        """UI.warn prints message in yellow."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.warn("Warning message")

        mock_console.print.assert_called_once()
        call_arg = mock_console.print.call_args[0][0]
        assert "Warning message" in call_arg
        assert "yellow" in call_arg

    def test_error_prints_red_x(self):
        """UI.error prints message with red X."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.error("Something failed")

        mock_console.print.assert_called_once()
        call_arg = mock_console.print.call_args[0][0]
        assert "✗" in call_arg
        assert "Something failed" in call_arg
        assert "red" in call_arg

    def test_title_prints_bold_yellow(self):
        """UI.title prints message in bold yellow with newline prefix."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.title("Section Title")

        mock_console.print.assert_called_once()
        call_arg = mock_console.print.call_args[0][0]
        assert "Section Title" in call_arg
        assert "bold yellow" in call_arg
        assert call_arg.startswith("\n")

    def test_info_prints_bold_cyan(self):
        """UI.info prints message in bold cyan."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.info("Info message")

        mock_console.print.assert_called_once()
        call_arg = mock_console.print.call_args[0][0]
        assert "Info message" in call_arg
        assert "bold cyan" in call_arg

    def test_bullet_prints_indented_cyan_bullet(self):
        """UI.bullet prints item with cyan bullet point."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.bullet("List item")

        mock_console.print.assert_called_once()
        call_arg = mock_console.print.call_args[0][0]
        assert "•" in call_arg
        assert "List item" in call_arg
        assert "cyan" in call_arg

    def test_bullets_prints_multiple_items(self):
        """UI.bullets prints multiple bullet items."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.bullets(["Item 1", "Item 2", "Item 3"])

        assert mock_console.print.call_count == 3
        for i, call in enumerate(mock_console.print.call_args_list, 1):
            assert f"Item {i}" in call[0][0]

    def test_panel_prints_rich_panel(self):
        """UI.panel prints content in a Rich panel."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.panel("Panel content", title="My Panel")

        mock_console.print.assert_called_once()
        call_arg = mock_console.print.call_args[0][0]
        # Check it's a Panel object
        from rich.panel import Panel

        assert isinstance(call_arg, Panel)

    def test_print_outputs_message(self):
        """UI.print outputs message to console."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.print("Simple message")

        mock_console.print.assert_called_once_with("Simple message")

    def test_print_empty_string(self):
        """UI.print can output empty string."""
        mock_console = MagicMock()
        UI._console = mock_console

        UI.print()

        mock_console.print.assert_called_once_with("")


class TestAskText:
    """Tests for ask_text function."""

    @patch("nao_core.ui.questionary.text")
    def test_returns_stripped_text(self, mock_text):
        """ask_text returns stripped user input."""
        mock_text.return_value.ask.return_value = "  user input  "

        result = ask_text("Enter value:")

        assert result == "user input"

    @patch("nao_core.ui.questionary.text")
    def test_raises_keyboard_interrupt_on_cancel(self, mock_text):
        """ask_text raises KeyboardInterrupt when user cancels."""
        mock_text.return_value.ask.return_value = None

        with pytest.raises(KeyboardInterrupt):
            ask_text("Enter value:")

    @patch("nao_core.ui.questionary.password")
    def test_uses_password_prompt_when_requested(self, mock_password):
        """ask_text uses password prompt when password=True."""
        mock_password.return_value.ask.return_value = "secret"

        result = ask_text("Enter password:", password=True)

        assert result == "secret"
        mock_password.assert_called_once()

    @patch("nao_core.ui.UI.warn")
    @patch("nao_core.ui.questionary.text")
    def test_loops_when_required_field_empty(self, mock_text, mock_warn):
        """ask_text loops and warns when required_field is empty."""
        # First return empty, then valid value
        mock_text.return_value.ask.side_effect = ["", "valid"]

        result = ask_text("Enter value:", required_field=True)

        assert result == "valid"
        mock_warn.assert_called_once_with("This field is required.")
        assert mock_text.return_value.ask.call_count == 2

    @patch("nao_core.ui.questionary.text")
    def test_uses_default_value(self, mock_text):
        """ask_text passes default value to questionary."""
        mock_text.return_value.ask.return_value = "default_value"

        ask_text("Enter value:", default="default_value")

        mock_text.assert_called_once_with("Enter value:", default="default_value")

    @patch("nao_core.ui.questionary.text")
    def test_returns_none_for_empty_non_required(self, mock_text):
        """ask_text returns None for empty input when not required."""
        mock_text.return_value.ask.return_value = ""

        result = ask_text("Enter value:", required_field=False)

        assert result is None


class TestAskConfirm:
    """Tests for ask_confirm function."""

    @patch("nao_core.ui.questionary.confirm")
    def test_returns_true_when_confirmed(self, mock_confirm):
        """ask_confirm returns True when user confirms."""
        mock_confirm.return_value.ask.return_value = True

        result = ask_confirm("Continue?")

        assert result is True

    @patch("nao_core.ui.questionary.confirm")
    def test_returns_false_when_declined(self, mock_confirm):
        """ask_confirm returns False when user declines."""
        mock_confirm.return_value.ask.return_value = False

        result = ask_confirm("Continue?")

        assert result is False

    @patch("nao_core.ui.questionary.confirm")
    def test_raises_keyboard_interrupt_on_cancel(self, mock_confirm):
        """ask_confirm raises KeyboardInterrupt when user cancels."""
        mock_confirm.return_value.ask.return_value = None

        with pytest.raises(KeyboardInterrupt):
            ask_confirm("Continue?")

    @patch("nao_core.ui.questionary.confirm")
    def test_uses_default_value(self, mock_confirm):
        """ask_confirm passes default value to questionary."""
        mock_confirm.return_value.ask.return_value = False

        ask_confirm("Continue?", default=False)

        mock_confirm.assert_called_once_with("Continue?", default=False)


class TestAskSelect:
    """Tests for ask_select function."""

    @patch("nao_core.ui.questionary.select")
    def test_returns_selected_choice(self, mock_select):
        """ask_select returns the selected choice."""
        mock_select.return_value.ask.return_value = "option2"

        result = ask_select("Choose:", choices=["option1", "option2", "option3"])

        assert result == "option2"

    @patch("nao_core.ui.questionary.select")
    def test_raises_keyboard_interrupt_on_cancel(self, mock_select):
        """ask_select raises KeyboardInterrupt when user cancels."""
        mock_select.return_value.ask.return_value = None

        with pytest.raises(KeyboardInterrupt):
            ask_select("Choose:", choices=["option1", "option2"])

    @patch("nao_core.ui.questionary.select")
    def test_uses_default_value(self, mock_select):
        """ask_select passes default value to questionary."""
        mock_select.return_value.ask.return_value = "option1"

        ask_select("Choose:", choices=["option1", "option2"], default="option1")

        mock_select.assert_called_once_with("Choose:", choices=["option1", "option2"], default="option1")
