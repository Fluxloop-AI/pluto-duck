"""Centralized configuration management for Pluto-Duck."""

import os
import shutil
import sys
from functools import lru_cache
from pathlib import Path
from typing import Optional
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_root() -> Path:
    """Return the platform-specific default data root."""

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "PlutoDuck"
    return Path.home() / ".pluto-duck"


DEFAULT_DATA_ROOT = _default_data_root()


def _get_template_path() -> Path:
    """Return the path to bundled templates."""
    # This works both in dev and when packaged
    return Path(__file__).parent.parent.parent / "templates"


def _ensure_dbt_project(target_path: Path) -> None:
    """Copy the bundled dbt template to target_path if it doesn't exist."""
    if target_path.exists() and (target_path / "dbt_project.yml").exists():
        # Project already exists, don't overwrite
        return
    
    template_path = _get_template_path() / "dbt"
    if not template_path.exists():
        raise RuntimeError(f"DBT template not found at {template_path}")
    
    # Copy template to target
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(template_path, target_path, dirs_exist_ok=True)


class DuckDBSettings(BaseModel):
    """Settings related to the embedded DuckDB warehouse."""

    path: Path = Field(default_factory=lambda: DEFAULT_DATA_ROOT / "data" / "warehouse.duckdb")
    threads: int = Field(default=4, ge=1, description="Number of DuckDB threads to use")


class DbtSettings(BaseModel):
    """Configuration for the bundled dbt project."""

    project_path: Path = Field(default_factory=lambda: DEFAULT_DATA_ROOT / "dbt")
    profiles_path: Optional[Path] = None


class AgentSettings(BaseModel):
    """LLM provider and agent-specific configuration."""

    provider: str = Field(default="openai", description="LLM provider identifier")
    model: str = Field(default="gpt-4.1-mini", description="Default model name")
    api_base: Optional[HttpUrl] = Field(default=None, description="Override base URL for provider")
    api_key: Optional[str] = Field(default=None, description="API key for the LLM provider")
    mock_mode: bool = Field(default=False, description="Use local mock responses instead of live LLM")
    reasoning_effort: Literal["minimal", "low", "medium", "high"] = Field(
        default="medium",
        description="Reasoning depth for GPT-5 family models",
    )
    text_verbosity: Literal["low", "medium", "high"] = Field(
        default="medium",
        description="Verbosity level for GPT-5 family models",
    )
    max_output_tokens: Optional[int] = Field(
        default=None,
        ge=1,
        description="Optional token cap for GPT-5 responses",
    )
    max_context_tokens: int = Field(
        default=8192,
        ge=512,
        description="Context window for local llama.cpp models",
    )
    n_gpu_layers: int = Field(
        default=-1,
        description="Number of layers to offload to GPU for llama.cpp (-1 = auto/all)",
    )
    n_threads: int = Field(
        default=0,
        ge=0,
        description="CPU threads for llama.cpp (0 = auto)",
    )


class DataDirectory(BaseModel):
    """Directory layout for Pluto-Duck artifacts."""

    root: Path = Field(default_factory=lambda: DEFAULT_DATA_ROOT)
    artifacts: Path = Field(default_factory=lambda: DEFAULT_DATA_ROOT / "artifacts")
    configs: Path = Field(default_factory=lambda: DEFAULT_DATA_ROOT / "configs")
    logs: Path = Field(default_factory=lambda: DEFAULT_DATA_ROOT / "logs")
    runtime: Path = Field(default_factory=lambda: DEFAULT_DATA_ROOT / "runtime")

    def ensure(self) -> None:
        """Create the necessary directories if they don't exist."""

        for directory in {self.root, self.artifacts, self.configs, self.logs, self.runtime}:
            directory.mkdir(parents=True, exist_ok=True)


class PlutoDuckSettings(BaseSettings):
    """Application-wide settings loaded from env, .env, and defaults."""

    data_dir: DataDirectory = Field(default_factory=DataDirectory)
    duckdb: DuckDBSettings = Field(default_factory=DuckDBSettings)
    dbt: DbtSettings = Field(default_factory=DbtSettings)
    agent: AgentSettings = Field(default_factory=AgentSettings)
    log_level: str = Field(default="INFO", description="Log verbosity")
    enable_telemetry: bool = Field(default=False, description="Send anonymous usage metrics")

    model_config = SettingsConfigDict(
        env_prefix="PLUTODUCK_",
        env_file=".env",
        extra="ignore",
        env_nested_delimiter="__",
    )

    def prepare_environment(self) -> None:
        """Ensure directories exist and derive dependent settings."""

        root_override = os.getenv("PLUTODUCK_DATA_DIR__ROOT")
        if root_override:
            self.data_dir.root = Path(root_override)

        agent_provider_override = os.getenv("PLUTODUCK_AGENT__PROVIDER")
        if agent_provider_override:
            self.agent.provider = agent_provider_override

        self.data_dir.ensure()
        # Fill derived paths if not explicitly provided
        if self.dbt.project_path == DEFAULT_DATA_ROOT / "dbt":
            self.dbt.project_path = self.data_dir.root / "dbt"
        if self.dbt.profiles_path is None:
            self.dbt.profiles_path = self.data_dir.configs / "dbt_profiles"
        
        # Initialize dbt project from template if it doesn't exist
        _ensure_dbt_project(self.dbt.project_path)


@lru_cache(maxsize=1)
def get_settings() -> PlutoDuckSettings:
    """Return a cached settings instance."""

    settings = PlutoDuckSettings()
    settings.prepare_environment()
    return settings


