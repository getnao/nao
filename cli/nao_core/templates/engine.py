"""Template engine for rendering Jinja2 templates with user overrides."""

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from nao_core.config.llm import LLMConfig, LLMProvider

# Path to the default templates shipped with nao
DEFAULT_TEMPLATES_DIR = Path(__file__).parent / "defaults"


class TemplateEngine:
    """Jinja2 template engine with support for user overrides.

    Templates are looked up in the following order:
    1. User's project `templates/` directory (if exists)
    2. Default templates shipped with nao

    This allows users to customize output by creating a `templates/` folder
    in their nao project and adding templates with the same names as the defaults.

    Example:
        If the default template is `databases/preview.md.j2`, the user can
        override it by creating `<project_root>/templates/databases/preview.md.j2`.
    """

    def __init__(self, project_path: Path | None = None, llm_config: LLMConfig | None = None):
        """Initialize the template engine.

        Args:
            project_path: Path to the nao project root. If provided,
                          templates in `<project_path>/templates/` will
                          take precedence over defaults.
            llm_config: Optional LLM settings used by the prompt(...) template helper.
        """
        self.project_path = project_path
        self.user_templates_dir = project_path / "templates" if project_path else None
        self.llm_config = llm_config

        # Build list of template directories (user templates first for override)
        loader_paths: list[Path] = []
        if self.user_templates_dir and self.user_templates_dir.exists():
            loader_paths.append(self.user_templates_dir)
        loader_paths.append(DEFAULT_TEMPLATES_DIR)

        self.env = Environment(
            loader=FileSystemLoader([str(p) for p in loader_paths]),
            autoescape=select_autoescape(default_for_string=False, default=False),
            trim_blocks=True,
            lstrip_blocks=True,
            keep_trailing_newline=True,
        )

        # Register custom filters
        self._register_filters()
        self._register_globals()

    def _register_filters(self) -> None:
        """Register custom Jinja2 filters for templates."""
        import json

        def to_json(value: Any, indent: int | None = None) -> str:
            """Convert value to JSON string."""
            return json.dumps(value, indent=indent, default=str)

        def truncate_middle(text: str, max_length: int = 50) -> str:
            """Truncate text in the middle if it exceeds max_length."""
            if len(str(text)) <= max_length:
                return str(text)
            half = (max_length - 3) // 2
            text = str(text)
            return text[:half] + "..." + text[-half:]

        self.env.filters["to_json"] = to_json
        self.env.filters["truncate_middle"] = truncate_middle

    def _register_globals(self) -> None:
        """Register template global helper functions."""
        self.env.globals["prompt"] = self._prompt

    def _prompt(self, text: str) -> str:
        """Generate text with the configured LLM.

        This helper is available in Jinja templates as prompt("...").
        """
        if not isinstance(text, str):
            raise ValueError("prompt(...) expects a single string argument.")

        prompt_text = text.strip()
        if not prompt_text:
            return ""

        if not self.llm_config:
            raise RuntimeError(
                "ai_summary generation requires an `llm` config in nao_config.yaml. "
                "Configure `llm.provider`, `llm.api_key` (except ollama), and optionally "
                "`llm.annotation_model`, or disable the `ai_summary` accessor."
            )

        if self.llm_config.provider != LLMProvider.OLLAMA and not self.llm_config.api_key:
            raise RuntimeError(
                f"ai_summary generation requires an API key for provider '{self.llm_config.provider.value}'. "
                "Set `llm.api_key` in nao_config.yaml or disable `ai_summary`."
            )

        model = self.llm_config.annotation_model
        if not model:
            raise RuntimeError("No annotation model configured. Set `llm.annotation_model` in nao_config.yaml.")

        try:
            if self.llm_config.provider in {LLMProvider.OPENAI, LLMProvider.OPENROUTER}:
                return self._generate_openai_compatible(model, prompt_text)
            if self.llm_config.provider == LLMProvider.ANTHROPIC:
                return self._generate_anthropic(model, prompt_text)
            if self.llm_config.provider == LLMProvider.MISTRAL:
                return self._generate_mistral(model, prompt_text)
            if self.llm_config.provider == LLMProvider.GEMINI:
                return self._generate_gemini(model, prompt_text)
            if self.llm_config.provider == LLMProvider.OLLAMA:
                return self._generate_ollama(model, prompt_text)
        except ImportError as e:
            raise RuntimeError(
                f"Provider '{self.llm_config.provider.value}' is not available in this environment: {e}"
            ) from e
        except Exception as e:
            raise RuntimeError(
                f"ai_summary generation failed with provider '{self.llm_config.provider.value}' and model '{model}': {e}"
            ) from e

        raise RuntimeError(f"Unsupported LLM provider '{self.llm_config.provider.value}' for ai_summary generation.")

    def _generate_openai_compatible(self, model: str, prompt_text: str) -> str:
        """Generate text via OpenAI-compatible chat completion APIs."""
        from openai import OpenAI

        kwargs: dict[str, Any] = {}
        if self.llm_config and self.llm_config.api_key:
            kwargs["api_key"] = self.llm_config.api_key
        if self.llm_config and self.llm_config.base_url:
            kwargs["base_url"] = self.llm_config.base_url
        elif self.llm_config and self.llm_config.provider == LLMProvider.OPENROUTER:
            kwargs["base_url"] = "https://openrouter.ai/api/v1"

        client = OpenAI(**kwargs)
        response = client.chat.completions.create(
            model=model,
            temperature=0,
            messages=[{"role": "user", "content": prompt_text}],
        )
        content = response.choices[0].message.content if response.choices else None
        if not content:
            raise RuntimeError("Empty response from model.")
        return str(content).strip()

    def _generate_anthropic(self, model: str, prompt_text: str) -> str:
        """Generate text via Anthropic Messages API."""
        from anthropic import Anthropic

        if not self.llm_config or not self.llm_config.api_key:
            raise RuntimeError("Missing API key for Anthropic.")

        client = Anthropic(api_key=self.llm_config.api_key)
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            temperature=0,
            messages=[{"role": "user", "content": prompt_text}],
        )

        parts: list[str] = []
        for block in response.content:
            text = getattr(block, "text", None)
            if text:
                parts.append(str(text))

        content = "\n".join(parts).strip()
        if not content:
            raise RuntimeError("Empty response from model.")
        return content

    def _generate_mistral(self, model: str, prompt_text: str) -> str:
        """Generate text via Mistral chat completion API."""
        from mistralai import Mistral
        from mistralai.models.chatcompletionrequest import MessagesTypedDict

        if not self.llm_config or not self.llm_config.api_key:
            raise RuntimeError("Missing API key for Mistral.")

        client = Mistral(api_key=self.llm_config.api_key)
        messages: list[MessagesTypedDict] = [{"role": "user", "content": prompt_text}]
        response = client.chat.complete(
            model=model,
            temperature=0,
            messages=messages,
        )
        content = response.choices[0].message.content if response.choices else None
        if not content:
            raise RuntimeError("Empty response from model.")
        return str(content).strip()

    def _generate_gemini(self, model: str, prompt_text: str) -> str:
        """Generate text via Google Gemini API."""
        from google import genai
        from google.genai import types

        if not self.llm_config or not self.llm_config.api_key:
            raise RuntimeError("Missing API key for Gemini.")

        client = genai.Client(api_key=self.llm_config.api_key)
        response = client.models.generate_content(
            model=model,
            contents=prompt_text,
            config=types.GenerateContentConfig(temperature=0),
        )

        content = getattr(response, "text", None)
        if content:
            return str(content).strip()
        raise RuntimeError("Empty response from model.")

    def _generate_ollama(self, model: str, prompt_text: str) -> str:
        """Generate text via local Ollama chat API."""
        import ollama

        response = ollama.chat(
            model=model,
            messages=[{"role": "user", "content": prompt_text}],
            options={"temperature": 0},
        )
        content = response.get("message", {}).get("content")
        if not content:
            raise RuntimeError("Empty response from model.")
        return str(content).strip()

    def render(self, template_name: str, **context: Any) -> str:
        """Render a template with the given context.

        Args:
            template_name: Name of the template file (e.g., 'databases/preview.md.j2')
            **context: Variables to pass to the template

        Returns:
            Rendered template string
        """
        template = self.env.get_template(template_name)
        return template.render(**context)

    def has_template(self, template_name: str) -> bool:
        """Check if a template exists.

        Args:
            template_name: Name of the template to check

        Returns:
            True if the template exists, False otherwise
        """
        try:
            self.env.get_template(template_name)
            return True
        except Exception:
            return False

    def list_templates(self, prefix: str) -> list[str]:
        """List all available templates under a given prefix.

        Merges defaults and user overrides, returning unique template names.
        """
        templates: set[str] = set()

        # Collect from default templates
        default_dir = DEFAULT_TEMPLATES_DIR / prefix
        if default_dir.exists():
            for path in default_dir.rglob("*.j2"):
                templates.add(f"{prefix}/{path.relative_to(default_dir)}")

        # Collect from user templates (may add new ones or override defaults)
        if self.user_templates_dir:
            user_dir = self.user_templates_dir / prefix
            if user_dir.exists():
                for path in user_dir.rglob("*.j2"):
                    templates.add(f"{prefix}/{path.relative_to(user_dir)}")

        return sorted(templates)

    def is_user_override(self, template_name: str) -> bool:
        """Check if a template is a user override.

        Args:
            template_name: Name of the template to check

        Returns:
            True if the user has provided a custom template
        """
        if not self.user_templates_dir:
            return False
        user_template = self.user_templates_dir / template_name
        return user_template.exists()


# Global template engine instance (lazily initialized)
_engine: TemplateEngine | None = None
_engine_signature: tuple[str | None, str | None, str | None, str | None, str | None] | None = None


def _llm_signature(llm_config: LLMConfig | None) -> tuple[str | None, str | None, str | None, str | None]:
    """Return a tuple of LLM config values used as a cache key for the template engine."""
    if not llm_config:
        return (None, None, None, None)
    return (
        llm_config.provider.value,
        llm_config.annotation_model,
        llm_config.base_url,
        llm_config.api_key,
    )


def get_template_engine(project_path: Path | None = None, llm_config: LLMConfig | None = None) -> TemplateEngine:
    """Get or create the template engine.

    Args:
        project_path: Path to the nao project root.
        llm_config: Optional LLM settings used by prompt(...) helper.

    Returns:
        The template engine instance
    """
    global _engine, _engine_signature
    signature = (
        str(project_path) if project_path else None,
        *_llm_signature(llm_config),
    )
    if _engine is None or _engine_signature != signature:
        _engine = TemplateEngine(project_path=project_path, llm_config=llm_config)
        _engine_signature = signature
    return _engine
