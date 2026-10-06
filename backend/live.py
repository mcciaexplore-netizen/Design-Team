"""Live ticket events pushed to signed-in browsers over a WebSocket."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import auth
import realtime
from database import get_db

router = APIRouter(tags=["live"])


# --- WebSockets ---
def _ws_session(websocket: WebSocket):
    """A short-lived DB session for WebSocket handshakes (honours dependency overrides, e.g. in tests)."""
    return (websocket.app.dependency_overrides.get(get_db) or get_db)()


@router.websocket("/ws/{user_ref}")
async def live_events(websocket: WebSocket, user_ref: str):
    """Live feed of ticket events for the signed-in user. The path segment is ignored; identity comes from the token."""
    gen = _ws_session(websocket)
    db = next(gen)
    try:
        user = await auth.authenticate_websocket(websocket, db)
    finally:
        gen.close()
    if not user:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    sub = await realtime.register(websocket, user)
    try:
        while True:
            await websocket.receive_text()  # We only push; this just notices the client leaving.
    except WebSocketDisconnect:
        pass
    finally:
        realtime.unregister(sub)
