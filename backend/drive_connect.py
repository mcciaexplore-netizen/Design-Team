"""One-time setup: let DesignDesk save files in your own Google Drive (My Drive works).

    python drive_connect.py path\\to\\client_secret.json

The JSON file is an OAuth client of type "Desktop app" from Google Cloud Console (DEPLOY.md has the steps). Your
browser opens; sign in with the Google account whose Drive should hold the files and allow access. The script then
prints one line: paste it into Vercel as GOOGLE_DRIVE_OAUTH. It works until you remove DesignDesk's access in your
Google account (Security > Third-party connections)."""
import http.server
import json
import secrets
import sys
import urllib.parse
import webbrowser

import httpx

AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/drive"


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        client = json.load(f)
    client = client.get("installed") or client.get("web") or client
    client_id, client_secret = client["client_id"], client["client_secret"]

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

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
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
    value = json.dumps({"client_id": client_id, "client_secret": client_secret, "refresh_token": r.json()["refresh_token"]})
    print("Connected. In Vercel > Settings > Environment Variables, add GOOGLE_DRIVE_OAUTH with this value "
          "(the whole line, and keep it private):\n")
    print(value)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
