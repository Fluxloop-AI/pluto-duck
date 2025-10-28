"""Registry for ingestion connectors."""

from __future__ import annotations

from typing import Dict, Iterable, Optional, Type

from .base import BaseConnector, SupportsConnector


class ConnectorRegistry:
    """Simple registry mapping connector names to constructors."""

    def __init__(self) -> None:
        self._registry: Dict[str, Type[BaseConnector]] = {}

    def register(self, connector_cls: Type[BaseConnector]) -> None:
        name = connector_cls.name
        if name in self._registry:
            raise ValueError(f"Connector '{name}' already registered")
        self._registry[name] = connector_cls

    def create(self, name: str, config: Dict[str, object]) -> BaseConnector:
        if name not in self._registry:
            raise KeyError(f"Unknown connector '{name}'")
        return self._registry[name](config)

    def list_connectors(self) -> Iterable[str]:
        return self._registry.keys()

    def get(self, name: str) -> Optional[Type[BaseConnector]]:
        return self._registry.get(name)


_registry = ConnectorRegistry()


def get_registry() -> ConnectorRegistry:
    return _registry


