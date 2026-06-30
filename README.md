# ProtonVPN Server List JSON Service

Small Node.js service that returns Proton's live VPN server-list JSON from:

```text
GET http://localhost:3000/
```

The response is always fetched from Proton's `/api/vpn/logicals` endpoint. The
server list itself is not cached locally.

## What It Does

1. Tries the cached Proton session from `proton-session-cache.json`.
2. Calls `https://account.protonvpn.com/api/vpn/logicals`.
3. Returns Proton's JSON response directly.
4. If Proton returns `401`, deletes the cached session, logs in again with
   Playwright, captures the current `x-pm-appversion`, `x-pm-uid`, and relevant
   session cookies, saves the new session, retries the API call, and returns the
   fresh JSON.

This avoids logging in on every request while still refreshing automatically
when the token expires.

## Requirements

- Node.js 20+
- npm
- Playwright Chromium
- Proton account credentials

## Setup

Install dependencies:

```powershell
npm.cmd install
npx.cmd playwright install chromium
```

Create the environment file:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```text
PORT=3000
PROTON_USERNAME=your-email
PROTON_PASSWORD=your-password
HEADLESS=true
```

`HEADLESS=true` has been tested successfully. Set `HEADLESS=false` only if
Proton starts requiring manual verification, 2FA, or another interactive browser
check.

## Run

```powershell
npm.cmd start
```

Then open:

```text
http://localhost:3000/
```

Or test from PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/ | Select-Object -ExpandProperty LogicalServers
```

## Development

Run with Node watch mode:

```powershell
npm.cmd run dev
```

Validate syntax:

```powershell
node --check src\server.js
```

## Railway Deploy

Set these Railway variables:

```text
PROTON_USERNAME=your-email
PROTON_PASSWORD=your-password
HEADLESS=true
```

The `postinstall` script runs `playwright install chromium` during deploy so the
Chromium binary exists in the Railway container. Without that step, Railway can
install the Playwright npm package but still fail at runtime with:

```text
browserType.launch: Executable doesn't exist
```

## Session Cache

`proton-session-cache.json` stores auth material:

- `x-pm-appversion`
- `x-pm-uid`
- relevant `AUTH-<uid>` cookie
- `Session-Id` cookie
- `savedAt`

It is gitignored and should be treated like a password.

To force a fresh login:

```powershell
Remove-Item .\proton-session-cache.json -Force
```

The next request to `/` will run Playwright login again and recreate the session
cache.

## Logs

The service logs simple stages:

```text
stage=session.cache.hit
stage=logicals.fetch
stage=logicals.done status=200
```

On a fresh login:

```text
stage=login.goto
stage=login.username
stage=login.password
stage=login.wait-signed-in
stage=login.done url=https://account.protonvpn.com/dashboard
stage=session.captured appVersion=true uid=true cookie=true
stage=session.cache.write
stage=logicals.fetch
stage=logicals.done status=200
```

## Security Notes

Do not commit these files:

- `.env`
- `proton-session-cache.json`
- logs that may contain operational details

The service intentionally does not expose captured cookies or generated curl
commands in the HTTP response. It only returns Proton's server-list JSON.

## Current Verified Behavior

Headless login and cached-session requests have both been tested:

```text
LOGICALSERVERS_COUNT=1585
stage=session.cache.hit
stage=logicals.fetch
stage=logicals.done status=200
```
