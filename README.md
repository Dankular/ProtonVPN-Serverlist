# ProtonVPN Server List Fetcher

Tiny Express + Playwright app that logs in through Proton's current web app,
captures the live `/api/vpn/logicals` request headers, and replays the API call
with the matching `x-pm-appversion`, `x-pm-uid`, and session cookies.

## Setup

```powershell
npm.cmd install
npx.cmd playwright install chromium
Copy-Item .env.example .env
```

Edit `.env` and set:

```text
PROTON_USERNAME=your-email
PROTON_PASSWORD=your-password
HEADLESS=false
```

`HEADLESS=false` is recommended because Proton may require a browser challenge,
2FA, or other interactive check.

## Run

```powershell
npm.cmd start
```

Open `http://localhost:3000`, then click **Fetch servers**. If Proton asks for
manual verification, complete it in the browser window Playwright opens.

The app keeps credentials out of source control and only uses cookies from the
current browser session.
