# ProtonVPN Server List

A small JSON service for retrieving Proton VPN's current server list.

Demo:

```text
https://protonvpn-serverlist.up.railway.app/
```

The service returns Proton's VPN logicals API response as JSON.

## Usage

Fetch the JSON directly:

```bash
curl https://protonvpn-serverlist.up.railway.app/
```

Use it from JavaScript:

```js
const response = await fetch('https://protonvpn-serverlist.up.railway.app/');
const data = await response.json();

console.log(`Server count: ${data.LogicalServers.length}`);
console.log(data.LogicalServers[0]);
```

Filter servers by country:

```js
const response = await fetch('https://protonvpn-serverlist.up.railway.app/');
const data = await response.json();

const usServers = data.LogicalServers.filter((server) => server.ExitCountry === 'US');

console.log(usServers.map((server) => ({
  name: server.Name,
  city: server.City,
  load: server.Load,
  tier: server.Tier
})));
```

Fetch from PowerShell:

```powershell
$data = Invoke-RestMethod https://protonvpn-serverlist.up.railway.app/
$data.LogicalServers | Where-Object ExitCountry -eq "US" | Select-Object Name,City,Load,Tier
```

## Response

The root response is Proton's JSON payload. The main array is usually:

```text
LogicalServers
```

Each logical server entry includes Proton-provided fields such as name, entry
country, exit country, city, load, tier, score, feature flags, and physical
server details.

## How It Works

The app keeps a Proton web session cached in `proton-session-cache.json` so it
does not need to log in on every request. For each request:

1. It calls Proton's live `/api/vpn/logicals` endpoint with the cached session.
2. If the session is still valid, it returns Proton's JSON response.
3. If Proton returns `401`, it refreshes the session with Playwright, saves the
   new session token, retries the API call, and returns the fresh JSON.

## Self Hosting

Install dependencies:

```bash
npm install
npx playwright install chromium
```

Create `.env`:

```bash
cp .env.example .env
```

Set:

```text
PORT=3000
PROTON_USERNAME=your-email
PROTON_PASSWORD=your-password
HEADLESS=true
```

Run:

```bash
npm start
```

Then request:

```text
http://localhost:3000/
```

## Deployment

The repo includes a Dockerfile based on Microsoft's Playwright image. This is
recommended for hosts such as Railway because Chromium needs Linux shared
libraries that are often missing from slim Node images.

Required environment variables:

```text
PROTON_USERNAME=your-email
PROTON_PASSWORD=your-password
HEADLESS=true
```

## Security

Do not commit:

- `.env`
- `proton-session-cache.json`
- runtime logs

`proton-session-cache.json` contains auth material and is gitignored.
