"""Campaigns and the record of social posts, kept in the User app: one shared list, open to everyone (no sign-in)."""
import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

import models
import ratelimit
from common import stored_file_response, read_upload, store_bytes
from database import get_db

IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
OWNER_KEY = "mccia"   # every row belongs to the one shared list; older rows keep their former client's key
WRITE_LIMIT, WRITE_WINDOW = 60, 3600   # writes per IP per hour: anyone can edit, so keep a lid on abuse

router = APIRouter(prefix="/api/public", tags=["campaigns"])


def _throttle_write(request: Request, db: Session) -> None:
    ratelimit.check(db, f"campaigns-write:{ratelimit.client_ip(request)}", WRITE_LIMIT, WRITE_WINDOW,
                    "Too many changes from your network. Please try again later.")


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


def _get(db: Session, model, row_id: int):
    row = db.query(model).filter(model.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return row


def _check_campaign(db: Session, campaign_id: Optional[int]) -> None:
    if campaign_id is not None:
        _get(db, models.Campaign, campaign_id)


@router.get("/campaigns")
def list_campaigns(db: Session = Depends(get_db)):
    rows = db.query(models.Campaign).order_by(models.Campaign.start_date.asc()).all()
    counts: dict = {}
    for (cid,) in db.query(models.SocialPost.campaign_id).filter(models.SocialPost.campaign_id.isnot(None)).all():
        counts[cid] = counts.get(cid, 0) + 1
    return [_campaign_out(c, counts.get(c.id, 0)) for c in rows]


@router.post("/campaigns", status_code=201)
def create_campaign(body: CampaignBody, request: Request, db: Session = Depends(get_db)):
    _throttle_write(request, db)
    c = models.Campaign(owner_key=OWNER_KEY, created_by_id=None, **body.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return _campaign_out(c)


@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, body: CampaignBody, request: Request, db: Session = Depends(get_db)):
    _throttle_write(request, db)
    c = _get(db, models.Campaign, campaign_id)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return _campaign_out(c)


@router.delete("/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, request: Request, db: Session = Depends(get_db)):
    _throttle_write(request, db)
    c = _get(db, models.Campaign, campaign_id)
    # The posts stay in the record, just no longer tied to a campaign.
    db.query(models.SocialPost).filter(models.SocialPost.campaign_id == c.id).update({"campaign_id": None})
    db.delete(c)
    db.commit()


@router.get("/social-posts")
def list_posts(campaign_id: Optional[int] = None, platform: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(models.SocialPost)
    if campaign_id is not None:
        q = q.filter(models.SocialPost.campaign_id == campaign_id)
    if platform:
        q = q.filter(models.SocialPost.platform == platform)
    return [_post_out(p) for p in q.order_by(models.SocialPost.post_date.desc(), models.SocialPost.id.desc()).all()]


@router.post("/social-posts", status_code=201)
def create_post(body: PostBody, request: Request, db: Session = Depends(get_db)):
    _throttle_write(request, db)
    _check_campaign(db, body.campaign_id)
    p = models.SocialPost(owner_key=OWNER_KEY, created_by_id=None, **body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _post_out(p)


@router.put("/social-posts/{post_id}")
def update_post(post_id: int, body: PostBody, request: Request, db: Session = Depends(get_db)):
    _throttle_write(request, db)
    p = _get(db, models.SocialPost, post_id)
    _check_campaign(db, body.campaign_id)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return _post_out(p)


@router.post("/social-posts/{post_id}/image")
async def upload_post_image(post_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    _throttle_write(request, db)
    p = _get(db, models.SocialPost, post_id)
    data, name, content_type = await read_upload(file)
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPG, GIF or WebP image")
    p.image_key, p.image_name, p.image_type = store_bytes(data, ext, name), name, content_type
    db.commit()
    return _post_out(p)


@router.get("/social-posts/{post_id}/image")
def get_post_image(post_id: int, request: Request, db: Session = Depends(get_db)):
    p = db.query(models.SocialPost).filter(models.SocialPost.id == post_id).first()
    if not p or not p.image_key:
        raise HTTPException(status_code=404, detail="Not found")
    return stored_file_response(request, p.image_key, p.image_name or "image", p.image_type or "application/octet-stream")


@router.delete("/social-posts/{post_id}/image", status_code=204)
def delete_post_image(post_id: int, request: Request, db: Session = Depends(get_db)):
    _throttle_write(request, db)
    p = _get(db, models.SocialPost, post_id)
    p.image_key = p.image_name = p.image_type = None
    db.commit()


@router.delete("/social-posts/{post_id}", status_code=204)
def delete_post(post_id: int, request: Request, db: Session = Depends(get_db)):
    _throttle_write(request, db)
    db.delete(_get(db, models.SocialPost, post_id))
    db.commit()
