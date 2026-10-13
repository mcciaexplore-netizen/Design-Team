"""Client campaigns and the record of social posts clients make themselves (no design work involved)."""
import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

import models
from auth import get_current_user, is_client
from common import file_response_headers, load_bytes, read_upload, store_bytes
from database import get_db

IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

router = APIRouter(tags=["campaigns"])


def _owner_key(user: models.User) -> str:
    return user.client_org or f"user:{user.id}"


def _scope(q, model, user: models.User, org: Optional[str]):
    """Clients see only their own organisation's rows. Staff see everything, or one client with ?org=."""
    if is_client(user):
        return q.filter(model.owner_key == _owner_key(user))
    return q.filter(model.owner_key == org) if org else q


def _require_client(user: models.User) -> None:
    if not is_client(user):
        raise HTTPException(status_code=403, detail="Only clients record their own campaigns and posts")


class CampaignBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=1000)
    color: str = Field(default="#2563eb", pattern=r"^#[0-9a-fA-F]{6}$")
    start_date: datetime.date
    end_date: datetime.date

    @model_validator(mode="after")
    def _ordered(self):
        if self.end_date < self.start_date:
            raise ValueError("The end date cannot be before the start date")
        return self


class PostBody(BaseModel):
    campaign_id: Optional[int] = None
    platform: Literal["Instagram", "Facebook", "LinkedIn", "WhatsApp", "X", "YouTube", "Other"]
    title: str = Field(min_length=1, max_length=200)
    post_url: Optional[str] = Field(default=None, max_length=500, pattern=r"^https?://\S+$")
    post_date: datetime.date
    status: Literal["Planned", "Posted"] = "Posted"
    notes: Optional[str] = Field(default=None, max_length=1000)


def _campaign_out(c: models.Campaign, post_count: int = 0) -> dict:
    return {"id": c.id, "name": c.name, "description": c.description, "color": c.color,
            "start_date": c.start_date.isoformat(), "end_date": c.end_date.isoformat(), "post_count": post_count}


def _post_out(p: models.SocialPost) -> dict:
    return {"id": p.id, "campaign_id": p.campaign_id, "platform": p.platform, "title": p.title, "post_url": p.post_url,
            "post_date": p.post_date.isoformat(), "status": p.status, "notes": p.notes,
            "has_image": bool(p.image_key)}


def _own(db: Session, model, row_id: int, user: models.User):
    row = db.query(model).filter(model.id == row_id).first()
    if not row or row.owner_key != _owner_key(user):
        raise HTTPException(status_code=404, detail="Not found")  # 404, so other clients' ids can't be probed
    return row


def _check_campaign(db: Session, campaign_id: Optional[int], user: models.User) -> None:
    if campaign_id is not None:
        _own(db, models.Campaign, campaign_id, user)


@router.get("/api/campaigns")
def list_campaigns(org: Optional[str] = None, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    rows = _scope(db.query(models.Campaign), models.Campaign, user, org).order_by(models.Campaign.start_date.asc()).all()
    counts: dict = {}
    posts = _scope(db.query(models.SocialPost.campaign_id), models.SocialPost, user, org).filter(models.SocialPost.campaign_id.isnot(None))
    for (cid,) in posts.all():
        counts[cid] = counts.get(cid, 0) + 1
    return [_campaign_out(c, counts.get(c.id, 0)) for c in rows]


@router.post("/api/campaigns", status_code=201)
def create_campaign(body: CampaignBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    c = models.Campaign(owner_key=_owner_key(user), created_by_id=user.id, **body.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return _campaign_out(c)


@router.put("/api/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, body: CampaignBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    c = _own(db, models.Campaign, campaign_id, user)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return _campaign_out(c)


@router.delete("/api/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    c = _own(db, models.Campaign, campaign_id, user)
    # The posts stay in the record, just no longer tied to a campaign.
    db.query(models.SocialPost).filter(models.SocialPost.campaign_id == c.id).update({"campaign_id": None})
    db.delete(c)
    db.commit()


@router.get("/api/social-posts")
def list_posts(org: Optional[str] = None, campaign_id: Optional[int] = None, platform: Optional[str] = None,
               db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    q = _scope(db.query(models.SocialPost), models.SocialPost, user, org)
    if campaign_id is not None:
        q = q.filter(models.SocialPost.campaign_id == campaign_id)
    if platform:
        q = q.filter(models.SocialPost.platform == platform)
    return [_post_out(p) for p in q.order_by(models.SocialPost.post_date.desc(), models.SocialPost.id.desc()).all()]


@router.post("/api/social-posts", status_code=201)
def create_post(body: PostBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    _check_campaign(db, body.campaign_id, user)
    p = models.SocialPost(owner_key=_owner_key(user), created_by_id=user.id, **body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _post_out(p)


@router.put("/api/social-posts/{post_id}")
def update_post(post_id: int, body: PostBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    p = _own(db, models.SocialPost, post_id, user)
    _check_campaign(db, body.campaign_id, user)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return _post_out(p)


@router.post("/api/social-posts/{post_id}/image")
async def upload_post_image(post_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    p = _own(db, models.SocialPost, post_id, user)
    data, name, content_type = await read_upload(file)
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPG, GIF or WebP image")
    p.image_key, p.image_name, p.image_type = store_bytes(data, ext), name, content_type
    db.commit()
    return _post_out(p)


@router.get("/api/social-posts/{post_id}/image")
def get_post_image(post_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    p = db.query(models.SocialPost).filter(models.SocialPost.id == post_id).first()
    if not p or not p.image_key or (is_client(user) and p.owner_key != _owner_key(user)):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=load_bytes(p.image_key), media_type=p.image_type or "application/octet-stream",
                    headers=file_response_headers(p.image_name or "image", p.image_type or ""))


@router.delete("/api/social-posts/{post_id}/image", status_code=204)
def delete_post_image(post_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    p = _own(db, models.SocialPost, post_id, user)
    p.image_key = p.image_name = p.image_type = None
    db.commit()


@router.delete("/api/social-posts/{post_id}", status_code=204)
def delete_post(post_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_client(user)
    db.delete(_own(db, models.SocialPost, post_id, user))
    db.commit()
