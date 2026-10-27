"""Campaigns and social posts live in the open User app: one shared list, no sign-in."""
import datetime

import campaigns_api
import models
from test_auth import TestingSessionLocal, client  # noqa: F401

CAMP = {"name": "Diwali sale", "start_date": "2026-10-20", "end_date": "2026-11-05", "color": "#e11d48"}
POST = {"platform": "Instagram", "title": "Festival teaser", "post_date": "2026-10-22"}


def test_anyone_records_campaigns_and_posts_without_signing_in(client):
    c = client.post("/api/public/campaigns", json=CAMP)
    assert c.status_code == 201 and c.json()["post_count"] == 0
    cid = c.json()["id"]

    p = client.post("/api/public/social-posts", json={**POST, "campaign_id": cid, "post_url": "https://instagram.com/p/abc"})
    assert p.status_code == 201 and p.json()["status"] == "Posted"
    client.post("/api/public/social-posts", json={**POST, "platform": "LinkedIn", "status": "Planned"})

    assert client.get("/api/public/campaigns").json()[0]["post_count"] == 1
    assert len(client.get("/api/public/social-posts").json()) == 2
    assert len(client.get(f"/api/public/social-posts?campaign_id={cid}").json()) == 1
    assert len(client.get("/api/public/social-posts?platform=LinkedIn").json()) == 1

    edited = client.put(f"/api/public/social-posts/{p.json()['id']}", json={**POST, "title": "Renamed"})
    assert edited.json()["title"] == "Renamed" and edited.json()["campaign_id"] is None
    assert client.put(f"/api/public/campaigns/{cid}", json={**CAMP, "name": "Diwali"}).json()["name"] == "Diwali"

    # Deleting a campaign keeps its posts.
    client.put(f"/api/public/social-posts/{p.json()['id']}", json={**POST, "campaign_id": cid})
    assert client.delete(f"/api/public/campaigns/{cid}").status_code == 204
    assert len(client.get("/api/public/social-posts").json()) == 2
    assert client.delete(f"/api/public/social-posts/{p.json()['id']}").status_code == 204

    db = TestingSessionLocal()
    row = db.query(models.SocialPost).first()
    assert row.owner_key == "mccia" and row.created_by_id is None
    db.close()


def test_one_shared_list_includes_older_client_rows(client):
    db = TestingSessionLocal()
    db.add(models.Campaign(owner_key="TATA", created_by_id=3, name="Old", start_date=datetime.date(2026, 1, 1),
                           end_date=datetime.date(2026, 1, 31)))
    db.commit()
    db.close()
    client.post("/api/public/campaigns", json=CAMP)
    assert sorted(c["name"] for c in client.get("/api/public/campaigns").json()) == ["Diwali sale", "Old"]


def test_unknown_ids_and_validation(client):
    assert client.put("/api/public/campaigns/999", json=CAMP).status_code == 404
    assert client.delete("/api/public/social-posts/999").status_code == 404
    assert client.post("/api/public/social-posts", json={**POST, "campaign_id": 999}).status_code == 404
    assert client.post("/api/public/campaigns", json={**CAMP, "end_date": "2026-10-01"}).status_code == 422
    assert client.post("/api/public/campaigns", json={**CAMP, "color": "red"}).status_code == 422
    assert client.post("/api/public/social-posts", json={**POST, "platform": "MySpace"}).status_code == 422
    assert client.post("/api/public/social-posts", json={**POST, "post_url": "javascript:alert(1)"}).status_code == 422


def test_the_old_signed_in_routes_are_gone(client):
    assert client.get("/api/campaigns").status_code == 404
    assert client.post("/api/social-posts", json=POST).status_code == 404


def test_writes_are_rate_limited_per_network(client, monkeypatch):
    monkeypatch.setattr(campaigns_api, "WRITE_LIMIT", 2)
    codes = [client.post("/api/public/campaigns", json=CAMP).status_code for _ in range(3)]
    assert codes == [201, 201, 429]
    assert client.get("/api/public/campaigns").status_code == 200   # reading is never limited


def test_post_image_upload(client):
    pid = client.post("/api/public/social-posts", json=POST).json()["id"]
    assert client.post("/api/public/social-posts", json=POST).json()["has_image"] is False
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20

    up = client.post(f"/api/public/social-posts/{pid}/image", files={"file": ("post.png", png, "image/png")})
    assert up.status_code == 200 and up.json()["has_image"] is True
    got = client.get(f"/api/public/social-posts/{pid}/image")
    assert got.status_code == 200 and got.content == png and got.headers["content-type"] == "image/png"

    # Only images, and the bytes must match the extension.
    assert client.post(f"/api/public/social-posts/{pid}/image", files={"file": ("a.pdf", b"%PDF-1", "application/pdf")}).status_code == 415
    assert client.post(f"/api/public/social-posts/{pid}/image", files={"file": ("a.png", b"nope", "image/png")}).status_code == 415

    assert client.delete(f"/api/public/social-posts/{pid}/image").status_code == 204
    assert client.get(f"/api/public/social-posts/{pid}/image").status_code == 404
