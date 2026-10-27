"""The design library: designers and Design Leads manage folders and files (with versions); clients can't see it."""
from test_approvals_reports import PNG, isolated  # noqa: F401  (keeps uploads in a temp folder)
from test_auth import auth, client  # noqa: F401  (shared fixture)

PNG2 = PNG + b"v2"


def folder(client, headers, name="Brand assets"):
    r = client.post("/api/library/folders", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def upload(client, headers, folder_id, name="MCCIA logo.png", data=PNG, **form):
    return client.post("/api/library/items", data={"folder_id": str(folder_id), **form},
                       files={"file": (name, data, "image/png")}, headers=headers)


def test_designers_and_leads_manage_files_and_versions(client):
    des, lead = auth(client, "des@x.com"), auth(client, "lead@x.com")
    fid = folder(client, des)
    r = upload(client, des, fid, tags="logo, Brand ,logo", usage_rights_note="Use on white only")
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["name"] == "MCCIA logo" and item["tags"] == ["logo", "Brand"] and item["versions"] == 1
    assert item["latest"]["file_name"] == "MCCIA logo.png" and item["latest"]["uploaded_by"] == "Designer"

    # The lead edits it, then a designer replaces the file; the old version stays in the history.
    other = folder(client, lead, "Templates")
    r = client.patch(f"/api/library/items/{item['id']}", json={"name": "Logo (blue)", "tags": ["logo"], "folder_id": other,
                                                               "is_approved_final": True}, headers=lead)
    assert r.status_code == 200 and r.json()["folder_id"] == other and r.json()["is_approved_final"] is True
    r = client.post(f"/api/library/items/{item['id']}/versions", data={"note": "Sharper edges"},
                    files={"file": ("logo-v2.png", PNG2, "image/png")}, headers=des)
    assert r.status_code == 201 and r.json()["versions"] == 2 and r.json()["latest"]["note"] == "Sharper edges"
    history = client.get(f"/api/library/items/{item['id']}/versions", headers=lead).json()
    assert [v["version"] for v in history] == [2, 1]
    assert client.get(f"/api/library/versions/{history[1]['id']}/file", headers=des).content == PNG
    assert client.get(f"/api/library/versions/{history[0]['id']}/file", headers=des).content == PNG2

    # Search finds it by tag or name, in any folder.
    assert [i["name"] for i in client.get("/api/library/items", params={"q": "LOGO"}, headers=des).json()] == ["Logo (blue)"]
    assert client.get("/api/library/items", params={"folder_id": fid}, headers=des).json() == []

    # A folder with files can't be deleted; once empty it can.
    assert client.delete(f"/api/library/folders/{other}", headers=des).status_code == 409
    assert client.delete(f"/api/library/items/{item['id']}", headers=des).status_code == 204
    assert client.get(f"/api/library/versions/{history[0]['id']}/file", headers=des).status_code == 404
    assert client.delete(f"/api/library/folders/{other}", headers=des).status_code == 204
    assert [f["name"] for f in client.get("/api/library/folders", headers=des).json()] == ["Brand assets"]


def test_folders_need_unique_names(client):
    des = auth(client, "des@x.com")
    fid = folder(client, des)
    assert client.post("/api/library/folders", json={"name": " brand  ASSETS "}, headers=des).status_code == 409
    assert client.patch(f"/api/library/folders/{fid}", json={"name": "   "}, headers=des).status_code == 422
    assert client.patch(f"/api/library/folders/{fid}", json={"name": "Logos"}, headers=des).json()["name"] == "Logos"


def test_strangers_cannot_reach_the_library(client):
    des = auth(client, "des@x.com")
    fid = folder(client, des)
    item = upload(client, des, fid).json()
    version = client.get(f"/api/library/items/{item['id']}/versions", headers=des).json()[0]["id"]
    for method, url in (("get", "/api/library/folders"), ("get", "/api/library/items"), ("get", f"/api/library/versions/{version}/file"),
                        ("delete", f"/api/library/items/{item['id']}"), ("delete", f"/api/library/folders/{fid}")):
        assert getattr(client, method)(url).status_code == 401, url
