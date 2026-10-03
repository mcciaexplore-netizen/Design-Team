"""Live event feed over WebSockets: lets every open browser tab refresh and show toasts when work changes."""
import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import WebSocket

import models

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Subscriber:
    ws: WebSocket
    user_id: int
    is_client: bool
    client_org: Optional[str]


_subscribers: set[Subscriber] = set()
_loop: Optional[asyncio.AbstractEventLoop] = None


def _can_see(sub: Subscriber, ticket_org: Optional[str], requester_id: Optional[int]) -> bool:
    """Same rule as ticket access: staff see everything, clients only their organisation's tickets."""
    if not sub.is_client:
        return True
    if sub.client_org:
        return ticket_org == sub.client_org
    return requester_id == sub.user_id


async def register(ws: WebSocket, user: models.User) -> Subscriber:
    global _loop
    _loop = asyncio.get_running_loop()
    sub = Subscriber(ws, user.id, user.role == models.RoleEnum.REQUESTER, user.client_org)
    _subscribers.add(sub)
    return sub


def unregister(sub: Subscriber) -> None:
    _subscribers.discard(sub)


async def _deliver(message: dict, ticket_org: Optional[str], requester_id: Optional[int]) -> None:
    for sub in list(_subscribers):
        if not _can_see(sub, ticket_org, requester_id):
            continue
        try:
            await sub.ws.send_json(message)
        except Exception:
            _subscribers.discard(sub)


def publish(message: dict, ticket: models.Ticket) -> None:
    """Thread-safe: callable from sync request handlers and cron jobs. Silently does nothing if nobody is connected."""
    if _loop is None or not _subscribers or _loop.is_closed():
        return
    try:
        asyncio.run_coroutine_threadsafe(_deliver(message, ticket.client_org, ticket.requester_id), _loop)
    except RuntimeError:
        logger.debug("Realtime publish skipped: event loop unavailable")
