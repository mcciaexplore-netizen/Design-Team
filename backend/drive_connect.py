"""One-time setup: let DesignDesk save files in your own Google Drive (My Drive works).

    python drive_connect.py path\\to\\client_secret.json

The JSON file is an OAuth client of type "Desktop app" from Google Cloud Console (DEPLOY.md has the steps). Your
browser opens; sign in with the Google account whose Drive should hold the files and allow access. The script creates
the folder "DesignDesk files" in that Drive and prints the two values for Vercel: GOOGLE_DRIVE_OAUTH and
GOOGLE_DRIVE_FOLDER_ID. It works until you remove DesignDesk's access in your Google account (Security > Third-party
connections).

It asks only for drive.file: access to the files DesignDesk itself creates, nothing else in the Drive. That permission
needs no Google review, so the consent screen can be "In production" (in "Testing", Google ends the sign-in after 7
days). The flip side: DesignDesk can only use a folder it made, which is why the script makes one."""
import http.server
import json
import secrets
import sys
import urllib.parse
import webbrowser

import httpx

AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/drive.file"
FILES = "https://www.googleapis.com/drive/v3/files"
WEB_PORT = 8765
WEB_REDIRECT = f"http://127.0.0.1:{WEB_PORT}/"


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        client = json.load(f)
    web = "web" in client
    client = client.get("installed") or client.get("web") or client
    client_id, client_secret = client["client_id"], client["client_secret"]
    if web:
        # A "Web application" client only accepts addresses listed on it, so use a fixed one and say where to add it.
        print(f"This is a Web application client. In Google Cloud Console > Credentials > this client > Authorized "
              f"redirect URIs, add {WEB_REDIRECT} and save (it can take a few minutes to apply).\n")

    state, got = secrets.token_urlsafe(16), {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
            if query.get("state") == state:
                got.update(query)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("<p>Done. You can close this tab and go back to the terminal.</p>".encode())

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", WEB_PORT if web else 0), Handler)
    redirect = f"http://127.0.0.1:{server.server_port}/"
    url = AUTH + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent", "state": state,
    })
    print("Opening your browser to sign in to Google. If it does not open, visit:\n" + url + "\n")
    webbrowser.open(url)
    while not got:
        server.handle_request()
    if "code" not in got:
        sys.exit(f"Google did not give access: {got.get('error', 'unknown error')}")

    r = httpx.post(TOKEN, data={"code": got["code"], "client_id": client_id, "client_secret": client_secret,
                                "redirect_uri": redirect, "grant_type": "authorization_code"})
    if r.status_code != 200 or "refresh_token" not in r.json():
        sys.exit(f"Google refused the sign-in ({r.status_code}): {r.text[:300]}")
    tokens = r.json()
    folder = httpx.post(f"{FILES}?fields=id,name", headers={"Authorization": f"Bearer {tokens['access_token']}"},
                        json={"name": "DesignDesk files", "mimeType": "application/vnd.google-apps.folder"})
    if folder.status_code != 200:
        sys.exit(f"Signed in, but could not create the folder ({folder.status_code}): {folder.text[:300]}")
    value = json.dumps({"client_id": client_id, "client_secret": client_secret, "refresh_token": tokens["refresh_token"]})
    print('Connected, and made the folder "DesignDesk files" in your Drive (rename or move it any time).\n'
          "In Vercel > Settings > Environment Variables, add these two (keep the first one private):\n")
    print("GOOGLE_DRIVE_OAUTH =")
    print(value)
    print("\nGOOGLE_DRIVE_FOLDER_ID =")
    print(folder.json()["id"])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
