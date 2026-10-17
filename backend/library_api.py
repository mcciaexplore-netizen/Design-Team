"""The design library: the team's shared folders of logos, brand assets, templates and finished designs.

Designers and Design Leads can see, add, edit, replace (as a new version) and delete everything in it; clients can't
see it. Folders hold items; an item is one asset with its versions (the newest is the current file)."""
import datetime
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from auth import require_staff
from common import MAX_CDR_BYTES, as_utc, delete_stored_file, read_upload, store_bytes, stored_file_response
from database import get_db

router = APIRouter(prefix="/api/library", tags=["library"])
logger = logging.getLogger(__name__)

MAX_TAGS = 20


def _tags(raw) -> list:
    """Tags from a list or a comma-separated string: trimmed, unique (ignoring case), at most MAX_TAGS."""
    items = raw if isinstance(raw, list) else str(raw or "").split(",")
    out, seen = [], set()
    for t in items:
        t = " ".join(str(t).split())[:40]
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:MAX_TAGS]


# ── Folders ──────────────────────────────────────────────────────────────────

class FolderBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _folder(db: Session, folder_id: int) -> models.Folder:
    f = db.query(models.Folder).filter(models.Folder.id == folder_id, models.Folder.is_deleted == False).first()  # noqa: E712
    if not f:
        raise HTTPException(status_code=404, detail="Folder not found")
    return f


def _clean_name(name: str) -> str:
    name = " ".join(name.split())
    if not name:
        raise HTTPException(status_code=422, detail="Give it a name.")
    return name


@router.get("/folders")
def list_folders(db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    counts = dict(db.query(models.LibraryItem.folder_id, func.count(models.LibraryItem.id))
                  .filter(models.LibraryItem.is_deleted == False).group_by(models.LibraryItem.folder_id).all())  # noqa: E712
    folders = db.query(models.Folder).filter(models.Folder.is_deleted == False).order_by(func.lower(models.Folder.name)).all()  # noqa: E712
    return [{"id": f.id, "name": f.name, "items": counts.get(f.id, 0)} for f in folders]


@router.post("/folders", status_code=201)
def create_folder(body: FolderBody, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    name = _clean_name(body.name)
    if db.query(models.Folder.id).filter(func.lower(models.Folder.name) == name.lower(), models.Folder.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=409, detail="There is already a folder with that name.")
    f = models.Folder(name=name)
    db.add(f)
    db.commit()
    return {"id": f.id, "name": f.name, "items": 0}


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: int, body: FolderBody, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    f = _folder(db, folder_id)
    name = _clean_name(body.name)
    if db.query(models.Folder.id).filter(func.lower(models.Folder.name) == name.lower(), models.Folder.id != f.id,
                                         models.Folder.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=409, detail="There is already a folder with that name.")
    f.name = name
    db.commit()
    return {"id": f.id, "name": f.name}


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    f = _folder(db, folder_id)
    if db.query(models.LibraryItem.id).filter(models.LibraryItem.folder_id == f.id, models.LibraryItem.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=409, detail="This folder still has files. Move or delete them first.")
    f.is_deleted = True
    db.commit()


# ── Items ────────────────────────────────────────────────────────────────────

def _version_out(v: models.LibraryItemVersion, people: dict) -> dict:
    by = people.get(v.uploaded_by_id)
    return {"id": v.id, "version": v.version_number, "file_name": v.file_name or f"file.{v.file_url.rsplit('.', 1)[-1]}",
            "content_type": v.content_type, "size_bytes": v.size_bytes, "note": v.note,
            "uploaded_by": by.full_name if by else None, "uploaded_at": as_utc(v.uploaded_at).isoformat() if v.uploaded_at else None}


def _items_out(db: Session, items: List[models.LibraryItem]) -> list:
    ids = [i.id for i in items] or [0]
    versions = db.query(models.LibraryItemVersion).filter(models.LibraryItemVersion.library_item_id.in_(ids)) \
        .order_by(models.LibraryItemVersion.version_number).all()
    latest, count = {}, {}
    for v in versions:   # ordered, so the last one seen is the newest
        latest[v.library_item_id] = v
        count[v.library_item_id] = count.get(v.library_item_id, 0) + 1
    people = {u.id: u for u in db.query(models.User).filter(models.User.id.in_({v.uploaded_by_id for v in latest.values()} or {0}))}
    return [{
        "id": i.id, "name": i.name, "folder_id": i.folder_id, "tags": i.tags or [],
        "is_approved_final": i.is_approved_final, "usage_rights_note": i.usage_rights_note,
        "expiry_date": as_utc(i.expiry_date).date().isoformat() if i.expiry_date else None,
        "versions": count.get(i.id, 0), "latest": _version_out(latest[i.id], people) if i.id in latest else None,
        "created_at": as_utc(i.created_at).isoformat() if i.created_at else None,
    } for i in items]


def _item(db: Session, item_id: int) -> models.LibraryItem:
    i = db.query(models.LibraryItem).filter(models.LibraryItem.id == item_id, models.LibraryItem.is_deleted == False).first()  # noqa: E712
    if not i:
        raise HTTPException(status_code=404, detail="File not found in the library")
    return i


@router.get("/items")
def list_items(folder_id: Optional[int] = None, q: str = Query(default="", max_length=100),
               db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    query = db.query(models.LibraryItem).filter(models.LibraryItem.is_deleted == False)  # noqa: E712
    if folder_id is not None:
        query = query.filter(models.LibraryItem.folder_id == folder_id)
    items = query.order_by(models.LibraryItem.created_at.desc(), models.LibraryItem.id.desc()).limit(500).all()
    needle = q.strip().lower()
    if needle:   # name or any tag; tags are JSON, so this filter runs here rather than in SQL
        items = [i for i in items if needle in i.name.lower() or any(needle in t.lower() for t in (i.tags or []))]
    return _items_out(db, items)


async def _save_version(db: Session, item: models.LibraryItem, file: UploadFile, note: Optional[str], user: models.User) -> None:
    data, name, content_type = await read_upload(file, MAX_CDR_BYTES)
    last = db.query(func.max(models.LibraryItemVersion.version_number)).filter(
        models.LibraryItemVersion.library_item_id == item.id).scalar() or 0
    key = store_bytes(data, name.rsplit(".", 1)[-1].lower(), name)
    db.add(models.LibraryItemVersion(library_item_id=item.id, version_number=last + 1, file_url=key, file_name=name,
                                     content_type=content_type, size_bytes=len(data), note=(note or "").strip() or None,
                                     uploaded_by_id=user.id))


@router.post("/items", status_code=201)
async def create_item(folder_id: int = Form(...), file: UploadFile = File(...), name: str = Form(default="", max_length=120),
                      tags: str = Form(default="", max_length=800), usage_rights_note: str = Form(default="", max_length=1000),
                      is_approved_final: bool = Form(default=False),
                      db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    _folder(db, folder_id)
    item = models.LibraryItem(folder_id=folder_id, name=" ".join(name.split()) or (file.filename or "Untitled").rsplit(".", 1)[0][:120],
                              tags=_tags(tags), usage_rights_note=usage_rights_note.strip() or None, is_approved_final=is_approved_final)
    db.add(item)
    db.flush()
    await _save_version(db, item, file, None, user)
    db.commit()
    return _items_out(db, [item])[0]


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    folder_id: Optional[int] = None
    tags: Optional[List[str]] = Field(default=None, max_length=MAX_TAGS)
    usage_rights_note: Optional[str] = Field(default=None, max_length=1000)
    is_approved_final: Optional[bool] = None
    expiry_date: Optional[datetime.date] = None


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: ItemUpdate, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    item = _item(db, item_id)
    sent = body.model_dump(exclude_unset=True)
    if "name" in sent:
        item.name = _clean_name(body.name)
    if "folder_id" in sent and body.folder_id is not None:
        item.folder_id = _folder(db, body.folder_id).id
    if "tags" in sent:
        item.tags = _tags(body.tags or [])
    if "usage_rights_note" in sent:
        item.usage_rights_note = (body.usage_rights_note or "").strip() or None
    if "is_approved_final" in sent and body.is_approved_final is not None:
        item.is_approved_final = body.is_approved_final
    if "expiry_date" in sent:
        item.expiry_date = datetime.datetime.combine(body.expiry_date, datetime.time(), datetime.timezone.utc) if body.expiry_date else None
    db.commit()
    return _items_out(db, [item])[0]


@router.post("/items/{item_id}/versions", status_code=201)
async def add_version(item_id: int, file: UploadFile = File(...), note: str = Form(default="", max_length=500),
                      db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    """Replace the file. The old one stays in the item's history."""
    item = _item(db, item_id)
    await _save_version(db, item, file, note, user)
    db.commit()
    return _items_out(db, [item])[0]


@router.get("/items/{item_id}/versions")
def list_versions(item_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    _item(db, item_id)
    rows = db.query(models.LibraryItemVersion).filter(models.LibraryItemVersion.library_item_id == item_id) \
        .order_by(models.LibraryItemVersion.version_number.desc()).all()
    people = {u.id: u for u in db.query(models.User).filter(models.User.id.in_({v.uploaded_by_id for v in rows} or {0}))}
    return [_version_out(v, people) for v in rows]


@router.get("/versions/{version_id}/file")
def version_file(version_id: int, request: Request, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    v = db.query(models.LibraryItemVersion).filter(models.LibraryItemVersion.id == version_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="File not found")
    _item(db, v.library_item_id)
    return stored_file_response(request, v.file_url, v.file_name or "file", v.content_type or "application/octet-stream")


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    """Delete the item with every version and its files."""
    import deletion
    item = _item(db, item_id)
    versions = db.query(models.LibraryItemVersion).filter(models.LibraryItemVersion.library_item_id == item.id).all()
    keys = {v.file_url for v in versions}
    db.query(models.CdrRequest).filter(models.CdrRequest.library_item_id == item.id).update(
        {"library_item_id": None}, synchronize_session=False)
    for v in versions:
        db.delete(v)
    db.delete(item)
    db.commit()
    for key in keys:
        if not deletion._file_in_use(db, key):
            try:
                delete_stored_file(key)
            except Exception:   # an unused copy left behind is harmless; the item is gone
                logger.exception("Could not delete stored file %s", key)
