from test_auth import TestingSessionLocal, auth, client  # noqa: F401

CAMP = {"name": "Diwali sale", "start_date": "2026-10-20", "end_date": "2026-11-05", "color": "#e11d48"}
POST = {"platform": "Instagram", "title": "Festival teaser", "post_date": "2026-10-22"}


def test_client_records_campaigns_and_posts(client):
    tata = auth(client, "a@tata.com")
    c = client.post("/api/campaigns", json=CAMP, headers=tata)
    assert c.status_code == 201 and c.json()["post_count"] == 0
    cid = c.json()["id"]

    p = client.post("/api/social-posts", json={**POST, "campaign_id": cid, "post_url": "https://instagram.com/p/abc"}, headers=tata)
    assert p.status_code == 201 and p.json()["status"] == "Posted"
    client.post("/api/social-posts", json={**POST, "platform": "LinkedIn", "status": "Planned"}, headers=tata)

    assert client.get("/api/campaigns", headers=tata).json()[0]["post_count"] == 1
    assert len(client.get("/api/social-posts", headers=tata).json()) == 2
    assert len(client.get(f"/api/social-posts?campaign_id={cid}", headers=tata).json()) == 1
    assert len(client.get("/api/social-posts?platform=LinkedIn", headers=tata).json()) == 1

    edited = client.put(f"/api/social-posts/{p.json()['id']}", json={**POST, "title": "Renamed"}, headers=tata)
    assert edited.json()["title"] == "Renamed" and edited.json()["campaign_id"] is None

    # Deleting a campaign keeps its posts.
    client.put(f"/api/social-posts/{p.json()['id']}", json={**POST, "campaign_id": cid}, headers=tata)
    assert client.delete(f"/api/campaigns/{cid}", headers=tata).status_code == 204
    assert len(client.get("/api/social-posts", headers=tata).json()) == 2
    assert client.delete(f"/api/social-posts/{p.json()['id']}", headers=tata).status_code == 204


def test_clients_are_isolated_and_staff_are_read_only(client):
    tata, acme, des = auth(client, "a@tata.com"), auth(client, "b@acme.com"), auth(client, "des@x.com")
    cid = client.post("/api/campaigns", json=CAMP, headers=tata).json()["id"]
    pid = client.post("/api/social-posts", json=POST, headers=tata).json()["id"]

    assert client.get("/api/campaigns", headers=acme).json() == []
    assert client.get("/api/social-posts", headers=acme).json() == []
    assert client.put(f"/api/campaigns/{cid}", json=CAMP, headers=acme).status_code == 404
    assert client.delete(f"/api/social-posts/{pid}", headers=acme).status_code == 404
    assert client.post("/api/social-posts", json={**POST, "campaign_id": cid}, headers=acme).status_code == 404

    assert len(client.get("/api/social-posts", headers=des).json()) == 1          # staff can read everything
    assert client.get("/api/social-posts?org=ACME", headers=des).json() == []
    assert client.post("/api/campaigns", json=CAMP, headers=des).status_code == 403
    assert client.post("/api/social-posts", json=POST, headers=des).status_code == 403


def test_validation(client):
    tata = auth(client, "a@tata.com")
    assert client.post("/api/campaigns", json={**CAMP, "end_date": "2026-10-01"}, headers=tata).status_code == 422
    assert client.post("/api/campaigns", json={**CAMP, "color": "red"}, headers=tata).status_code == 422
    assert client.post("/api/social-posts", json={**POST, "platform": "MySpace"}, headers=tata).status_code == 422
    assert client.post("/api/social-posts", json={**POST, "post_url": "javascript:alert(1)"}, headers=tata).status_code == 422


def test_post_image_upload(client):
    tata, acme, des = auth(client, "a@tata.com"), auth(client, "b@acme.com"), auth(client, "des@x.com")
    pid = client.post("/api/social-posts", json=POST, headers=tata).json()["id"]
    assert client.post("/api/social-posts", json=POST, headers=tata).json()["has_image"] is False
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20

    up = client.post(f"/api/social-posts/{pid}/image", files={"file": ("post.png", png, "image/png")}, headers=tata)
    assert up.status_code == 200 and up.json()["has_image"] is True
    got = client.get(f"/api/social-posts/{pid}/image", headers=tata)
    assert got.status_code == 200 and got.content == png and got.headers["content-type"] == "image/png"
    assert client.get(f"/api/social-posts/{pid}/image", headers=des).status_code == 200      # staff can view
    assert client.get(f"/api/social-posts/{pid}/image", headers=acme).status_code == 404     # other clients cannot
    assert client.post(f"/api/social-posts/{pid}/image", files={"file": ("p.png", png, "image/png")}, headers=des).status_code == 403

    # Only images, and the bytes must match the extension.
    assert client.post(f"/api/social-posts/{pid}/image", files={"file": ("a.pdf", b"%PDF-1", "application/pdf")}, headers=tata).status_code == 415
    assert client.post(f"/api/social-posts/{pid}/image", files={"file": ("a.png", b"nope", "image/png")}, headers=tata).status_code == 415

    assert client.delete(f"/api/social-posts/{pid}/image", headers=tata).status_code == 204
    assert client.get(f"/api/social-posts/{pid}/image", headers=tata).status_code == 404
