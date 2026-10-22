# Plan: Document Google Drive setup from Settings

## Summary
Commit `94f12a9` added **Connect Google Drive** to Settings > Email & storage, and the page says "DEPLOY.md has the
steps", but DEPLOY.md still only describes the older ways (environment variables set by hand). This plan rewrites the
"Google Drive for files" section of DEPLOY.md around the Settings flow, adds the new variables to `.env.example`, and
fixes a broken command path at DEPLOY.md line 82.

## User Story
As the person deploying DesignDesk, I want DEPLOY.md to walk me through connecting Google Drive from Settings, so that
I can set it up without reading the code, and know what happens when Google ends the sign-in.

## Problem → Solution
DEPLOY.md documents only `GOOGLE_DRIVE_OAUTH` / `GOOGLE_DRIVE_CREDENTIALS`. The new variables are not mentioned
anywhere, and the command at line 82 shows tab characters → DEPLOY.md leads with the Settings flow, keeps the two older
ways as alternatives, and explains the 7-day limit, reminders, the database fallback, switching accounts and
`SECRET_KEY`.

## Metadata
- **Complexity**: Small (documentation only)
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 2 (`DEPLOY.md`, `.env.example`)

---

## UX Design

### Before
```
Settings > Email & storage:  "...then Connect Google Drive below; DEPLOY.md has the steps."
DEPLOY.md > Google Drive:    A. drive_connect.py + GOOGLE_DRIVE_OAUTH   B. Shared Drive service account
                             (no GOOGLE_OAUTH_CLIENT_ID, no redirect URI, no 7-day limit, no Settings button)
```

### After
```
DEPLOY.md > Google Drive:
  A. Connect from Settings (recommended)  : Cloud Console -> Web application client -> 2 Vercel vars -> button
     What to expect                       : 7-day limit in "Testing", reminder, fallback to the database,
                                            reconnect / switch account, SECRET_KEY
  B. Without Settings: drive_connect.py   : the old way A, path fixed
  C. Workspace Shared Drive               : unchanged
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| DEPLOY.md, Google Drive section | Only the env-variable ways | Settings flow first, older ways after | The page copy in `SettingsPage.tsx` already points here |
| DEPLOY.md, line 82 | `python drive_connect.py path<TAB>o<TAB>hat-file.json` | `python drive_connect.py path\to\client_secret.json` | Matches the script's own usage line |
| `.env.example` | No OAuth client variables | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | Comment says which way uses what |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `DEPLOY.md` | 66-104 | The section being rewritten; match its voice |
| P0 | `backend/drive_connect_api.py` | 1-60 | Redirect URI rules, scopes, `switch` |
| P0 | `backend/gdrive.py` | 36-140 | Which way wins (`enabled`, `_personal`, `_folder_id`), encryption, lapse |
| P1 | `backend/cron_jobs.py` | 135-167 | Reminder a day ahead and the lapse message: who gets them |
| P1 | `frontend/src/pages/SettingsPage.tsx` | 19-30, 115-150 | Exact button labels and messages to quote |
| P1 | `.env.example` | 36-42 | Where the new variables go |
| P2 | `backend/drive_connect.py` | 1-12 | Script usage line, Desktop vs Web client, drive.file note |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Refresh token lifetime in Testing | Google Identity, "Using OAuth 2.0 > Refresh token expiration" | An External app in "Testing" gets refresh tokens that expire after 7 days. Internal apps and apps "In production" don't have that limit. |
| `drive.file` scope | Google Drive API, "Choose scopes" | Recommended, non-sensitive scope: no verification needed to publish the app. |

No other research is needed. `drive_connect.py` already states both points (lines 10-12).

---

## Patterns to Mirror

### DOC VOICE: numbered steps, bold UI labels, `code` for variables, short "what happens" paragraphs
// SOURCE: DEPLOY.md:77-90
```
1. In [Google Cloud Console](https://console.cloud.google.com), in a project: enable the **Google Drive API**. Then
   APIs & Services > **OAuth consent screen**: user type **Internal** (only people in your Google Workspace), app name
   "DesignDesk", your email; save.
...
It keeps working until that account removes DesignDesk's access (Google Account > Security > Third-party
connections), or the account is deleted. Then run step 3 again.
```
Wrap lines at about 118 characters, like the rest of the file. Navigation uses `>`. Use plain words ("sign-in" rather
than "OAuth token").

### FACT: redirect URI
// SOURCE: backend/drive_connect_api.py:40-46
```python
def redirect_uri(request: Request) -> str:
    """Where Google sends the person back. On Vercel the API sits under /api, so the path is /api/api/…"""
    if os.getenv("GOOGLE_OAUTH_REDIRECT_URI"):
        return os.environ["GOOGLE_OAUTH_REDIRECT_URI"]
    if os.getenv("VERCEL"):
        return f"{app_url()}/api{CALLBACK}"
    return str(request.base_url).rstrip("/") + CALLBACK
```
→ On Vercel: `<PUBLIC_APP_URL>/api/api/integrations/drive/callback` (the doubled `/api` is correct). Settings shows the
exact value under the buttons ("Redirect URI for the Google OAuth client"), so the doc says to copy it from there.
`app_url()` (backend/common.py:416-421) uses `PUBLIC_APP_URL`, else the Vercel production domain.

### FACT: which way wins
// SOURCE: backend/gdrive.py (enabled / _personal)
```python
def enabled() -> bool:
    if os.getenv("GOOGLE_DRIVE_FOLDER_ID") and (os.getenv("GOOGLE_DRIVE_OAUTH") or os.getenv("GOOGLE_DRIVE_CREDENTIALS")):
        return True
    return _usable_connection() is not None
```
→ If `GOOGLE_DRIVE_OAUTH` or `GOOGLE_DRIVE_CREDENTIALS` is set, the Settings connection is not used. The doc must
say: "To use Settings, remove `GOOGLE_DRIVE_OAUTH`, `GOOGLE_DRIVE_CREDENTIALS` and `GOOGLE_DRIVE_FOLDER_ID` from
Vercel."

### FACT: messages and labels to quote exactly
// SOURCE: frontend/src/pages/SettingsPage.tsx
- Buttons: **Connect Google Drive**, **Reconnect Google Drive**, **Switch Google account**, **Check Google Drive**
- The folder made in the Drive is named **DesignDesk files**
- Reminder (cron_jobs.py): sent to every active Design Lead and Admin a day before the sign-in ends, and again
  when it has ended. Both are in-app notifications of type `DRIVE_SIGN_IN`, plus email if email is set up.

### FACT: SECRET_KEY
// SOURCE: backend/gdrive.py `_fernet` / `_opened`
→ The saved sign-in is encrypted with a key derived from `SECRET_KEY`. Changing `SECRET_KEY` shows Drive as
disconnected until someone clicks **Reconnect Google Drive**. Files stay in Drive, and reconnecting with the same
account keeps the folder.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `DEPLOY.md` | UPDATE | Rewrite "Google Drive for files" (lines 66-104); fix line 82; mention the new variables in step 3 (line 13-15) |
| `.env.example` | UPDATE | Add the 3 OAuth client variables next to the Drive block (lines 37-42) |

## NOT Building

- No code or UI changes. The Settings text already points to DEPLOY.md.
- No change to how the two older ways work, and neither is removed.
- No README change: README line 6 already links DEPLOY.md for Drive.
- No screenshots.

---

## Step-by-Step Tasks

### Task 1: Fix the broken command at line 82
- **ACTION**: Replace the tab-mangled path.
- **IMPLEMENT**: `python drive_connect.py path\to\client_secret.json`, the same as the script's usage line (drive_connect.py:3).
- **GOTCHA**: The tabs came from `\t` being treated as an escape. Make the edit with the Edit tool, not a shell
  `echo` or `sed` that turns `\t` into a tab again.
- **VALIDATE**: `grep -nP '\t' DEPLOY.md` prints nothing.

### Task 2: Add "A. Connect from Settings (recommended)"
- **ACTION**: Insert it as the first subsection of "Google Drive for files". Rename the existing A to B and B to C.
- **IMPLEMENT** (steps, in the doc's voice):
  1. Cloud Console: enable the **Google Drive API**. **OAuth consent screen**: **Internal** if everyone uses one
     Google Workspace, else **External**. For External, either add the signing-in account under **Test users**
     (the sign-in then lasts 7 days, see below), or click **Publish app** (drive.file needs no Google review).
  2. Credentials > Create credentials > **OAuth client ID** > type **Web application**. Under **Authorized redirect
     URIs** paste the address shown in Settings > Email & storage ("Redirect URI for the Google OAuth client"). On
     Vercel that is `https://<your app>/api/api/integrations/drive/callback`; the doubled `/api` is correct.
  3. Vercel env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (keep the secret private). Remove
     `GOOGLE_DRIVE_OAUTH`, `GOOGLE_DRIVE_CREDENTIALS` and `GOOGLE_DRIVE_FOLDER_ID` if they are set, because they take
     priority. Redeploy.
  4. Settings > Email & storage > **Connect Google Drive**. Sign in with the account whose Drive should hold the files
     and allow access. DesignDesk makes the folder **DesignDesk files** there. Then click **Check Google Drive**.
- Then a short **"What to expect"** list:
  - **7-day limit**: with an External app in Testing, Google ends the sign-in after 7 days. Settings shows the date.
    Design Leads and Admins get a reminder a day ahead, and another notice when it has ended.
  - **When it ends**: new uploads are kept in the database until someone clicks **Reconnect Google Drive**. Files
    already in Drive stay there and work again after reconnecting. Publishing the app (step 1) removes the limit.
  - **Reconnect with the same account.** A different account is refused, because DesignDesk can only open files it
    made with the connected account. **Switch Google account** moves to another account after a warning: files saved
    so far stop opening in DesignDesk.
  - **`SECRET_KEY`**: the saved sign-in is encrypted with it. Changing it disconnects Drive until someone reconnects.
  - `GOOGLE_OAUTH_REDIRECT_URI` overrides the redirect address (for a custom domain set up some other way).
- **MIRROR**: DOC VOICE.
- **GOTCHA**: Quote button labels exactly, from the facts above. Don't promise that reconnecting restores access with
  a *different* account.
- **VALIDATE**: Every variable name appears in `backend/*.py` (`grep -n GOOGLE_OAUTH backend/*.py`).

### Task 3: Retitle the older ways
- **ACTION**: "### B. Without Settings: `drive_connect.py`" (former A). Add one line at the top: "Use this only if you
  prefer environment variables. A and B are alternatives; set up one." "### C. A Workspace Shared Drive (service
  account)" (former B) stays as it is.
- **IMPLEMENT**: Change the intro paragraph (lines 68-71). Remove "There are two ways to connect; use one". Say that
  **Check Google Drive** works for all three. Move the `GOOGLE_DRIVE_FOLDER_ID` explanation into B and C, since A
  doesn't use it.
- **VALIDATE**: Each heading appears exactly once. `GOOGLE_DRIVE_FOLDER_ID` isn't mentioned as needed for A.

### Task 4: Mention the variables in the Vercel steps
- **ACTION**: DEPLOY.md lines 13-15 ("Email and Google Drive are below"). Leave them unchanged if they still read
  correctly. Optionally add: "`SECRET_KEY` also protects the saved Google Drive sign-in."
- **VALIDATE**: Read lines 1-32 straight through. They still make sense.

### Task 5: `.env.example`
- **ACTION**: Above the existing Drive block (line 37), add:
  ```
  # Google Drive connected from Settings > Email & storage (see DEPLOY.md, way A): an OAuth client of type
  # "Web application". GOOGLE_OAUTH_REDIRECT_URI is optional (Settings shows the address it uses).
  GOOGLE_OAUTH_CLIENT_ID=
  GOOGLE_OAUTH_CLIENT_SECRET=
  GOOGLE_OAUTH_REDIRECT_URI=
  ```
  and change the existing comment to say it is "ways B and C, which take priority over Settings".
- **VALIDATE**: `grep -c GOOGLE_OAUTH .env.example` prints 3.

---

## Testing Strategy

Documentation only, so there are no unit tests. Check by reading and with greps:

| Check | Command | Expected |
|---|---|---|
| No stray tabs | `grep -nP '\t' DEPLOY.md` | nothing |
| Every documented variable exists in code | `for v in GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_REDIRECT_URI; do grep -q $v backend/*.py && echo ok $v; done` | 3 × ok |
| Labels match the UI | `grep -o "Connect Google Drive\|Reconnect Google Drive\|Switch Google account\|Check Google Drive" frontend/src/pages/SettingsPage.tsx \| sort -u` | all 4 present |
| Callback path | `grep -n "integrations/drive/callback" backend/drive_connect_api.py` | matches the doc |

### Edge Cases Checklist
- [ ] Reader has old `GOOGLE_DRIVE_*` variables set: the doc tells them to remove them
- [ ] Internal vs External consent screen are both covered
- [ ] Custom domain: `PUBLIC_APP_URL`, or `GOOGLE_OAUTH_REDIRECT_URI`, as an override
- [ ] Different account / switch covered
- [ ] `SECRET_KEY` rotation covered

---

## Validation Commands

### Static Analysis
```bash
grep -nP '\t' DEPLOY.md || echo "no tabs"
```
EXPECT: `no tabs`

### Full Test Suite (no regressions; docs only)
```bash
cd backend && python -m pytest -q
```
EXPECT: 244 passed

### Manual Validation
- [ ] Read the new section top to bottom as someone new to the project
- [ ] Follow steps 1-4 on the live site once, and check the redirect URI shown in Settings matches the doc

---

## Acceptance Criteria
- [ ] Settings flow documented as way A, with the 7-day limit, fallback, reminders, switch and `SECRET_KEY`
- [ ] Line 82 fixed; no tabs in DEPLOY.md
- [ ] `.env.example` lists the 3 new variables
- [ ] Every label and variable name matches the code exactly

## Completion Checklist
- [ ] Matches DEPLOY.md's voice and line width
- [ ] No promises the code doesn't keep
- [ ] No unnecessary scope additions

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google renames consent-screen menus (now "Google Auth Platform > Audience / Clients") | Medium | Low | Name both the older and newer menu labels where they differ, e.g. "OAuth consent screen (Google Auth Platform)" |
| Reader keeps `GOOGLE_DRIVE_OAUTH` set and wonders why Settings has no effect | Medium | Medium | Explicit "remove these" in step 3. **Code note (not in scope):** with only `GOOGLE_DRIVE_OAUTH` set and no folder variable, `_personal()` uses the env token with the saved folder. That's a mixed state worth tidying in code later |
| Wrong redirect URI (missing the doubled `/api`) | High | Medium | Tell readers to copy it from Settings and not type it |

## Notes
- The doc should *recommend* publishing the app ("In production") or Internal, so the 7-day limit never comes up. The
  reminder and fallback are the safety net, not the plan.
- Confidence for single-pass implementation: 9/10.
