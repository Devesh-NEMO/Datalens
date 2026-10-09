"""Router registration.

Every endpoint is declared in its own module and included here. Each module is
added to both the versioned ``/v1`` router and the unversioned alias from the
*same* handler object, so the two surfaces cannot drift apart.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api import (
    routes,
    routes_ai,
    routes_auth,
    routes_compare,
    routes_conversations,
    routes_datasets,
    routes_explore,
    routes_transforms,
)

#: Unversioned surface, kept for the existing frontend and any curl habit.
router = APIRouter()

#: Versioned surface. Everything new lives here.
v1_router = APIRouter(prefix="/v1")

#: Order sets the order in the OpenAPI page, grouped by feature.
_MODULES = (
    routes,  # system + analysis
    routes_datasets,  # library / history
    routes_explore,  # data explorer
    routes_compare,  # dataset comparison
    routes_conversations,  # question threads
    routes_transforms,  # confirmed data-quality corrections
    routes_ai,  # insights, ask, provider status
    routes_auth,  # registration, sessions
)

for _module in _MODULES:
    for _target in (router, v1_router):
        _target.include_router(_module.router)


__all__ = ["router", "v1_router"]
