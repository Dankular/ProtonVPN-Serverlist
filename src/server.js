import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const app = express();
const port = Number(process.env.PORT || 3000);

const LOGIN_URL = 'https://account.protonvpn.com/login';
const LOGICALS_URL = 'https://account.protonvpn.com/api/vpn/logicals';
const ACCEPT = 'application/vnd.protonmail.v1+json';
const SESSION_CACHE_PATH = new URL('../proton-session-cache.json', import.meta.url);
const headless = String(process.env.HEADLESS ?? 'false') === 'true';

let sessionCache = null;
let refreshPromise = null;

function requireCredential(envName, displayName) {
  const value = process.env[envName];
  if (!value) {
    const err = new Error(`${displayName} is required. Set ${envName} in .env.`);
    err.status = 500;
    throw err;
  }
  return value;
}

function pickCookies(cookieHeader) {
  if (!cookieHeader) return '';

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^AUTH-[^=]+=/.test(part) || /^Session-Id=/.test(part))
    .join('; ');
}

function pickCookiesFromJar(cookies) {
  return cookies
    .filter((cookie) => /^AUTH-/.test(cookie.name) || cookie.name === 'Session-Id')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function cookieMap(cookieHeader) {
  const map = new Map();
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    map.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return map;
}

function relevantCookie(cookieHeader, uid) {
  if (!cookieHeader || !uid) return '';

  const cookies = cookieMap(cookieHeader);
  const auth = cookies.get(`AUTH-${uid}`);
  const sessionId = cookies.get('Session-Id');

  if (!auth || !sessionId) return '';

  return `AUTH-${uid}=${auth}; Session-Id=${sessionId}`;
}

function uidFromCookie(cookieHeader) {
  const match = cookieHeader.match(/(?:^|;\s*)AUTH-([^=;]+)=/);
  return match?.[1] || '';
}

function normalizeHeaders(headers) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) {
    lower[key.toLowerCase()] = value;
  }
  return lower;
}

function isUsableSession(session) {
  return Boolean(session?.appVersion && session?.uid && session?.cookie);
}

async function readSessionCache() {
  if (sessionCache) return sessionCache;

  try {
    const text = await fs.readFile(SESSION_CACHE_PATH, 'utf8');
    const session = JSON.parse(text);
    if (!isUsableSession(session)) return null;

    sessionCache = {
      appVersion: session.appVersion,
      uid: session.uid,
      cookie: session.cookie
    };
    console.log('stage=session.cache.hit');
    return sessionCache;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`stage=session.cache.read-failed message=${error.message}`);
    }
    return null;
  }
}

async function writeSessionCache(session) {
  await fs.writeFile(
    SESSION_CACHE_PATH,
    JSON.stringify(
      {
        appVersion: session.appVersion,
        uid: session.uid,
        cookie: session.cookie,
        savedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  console.log('stage=session.cache.write');
}

async function deleteSessionCache() {
  sessionCache = null;
  await fs.rm(SESSION_CACHE_PATH, { force: true });
  console.log('stage=session.cache.delete');
}

function createRequestCollector(page) {
  const state = {
    appVersion: '',
    uid: '',
    cookie: ''
  };

  page.on('request', async (request) => {
    if (!request.url().includes('/api/')) return;

    try {
      const headers = normalizeHeaders(await request.allHeaders());
      state.appVersion = headers['x-pm-appversion'] || state.appVersion;
      state.uid = headers['x-pm-uid'] || state.uid;
      state.cookie = pickCookies(headers.cookie) || state.cookie;
    } catch (error) {
      console.warn(`stage=request-collector.warn message=${error.message}`);
    }
  });

  return state;
}

async function loginIfNeeded(page, username, password) {
  console.log('stage=login.goto');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  console.log('stage=login.username');
  const emailInput = page
    .locator('input#username, input[name="username"], input[autocomplete="username"], input[type="email"]')
    .first();
  await emailInput.waitFor({ state: 'visible', timeout: 45000 });
  await emailInput.fill(username);

  await page.locator('button[type="submit"]').first().click();

  console.log('stage=login.password');
  const passwordInput = page
    .locator('input#password, input[name="password"], input[autocomplete="current-password"], input[type="password"]')
    .first();
  await passwordInput.waitFor({ state: 'visible', timeout: 45000 });
  await passwordInput.fill(password);

  await page.locator('button[type="submit"]').first().click();

  console.log('stage=login.wait-signed-in');
  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 120000 });
  console.log(`stage=login.done url=${page.url()}`);
}

async function waitForSessionMaterial(context, captured, timeoutMs = 30000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const cookies = await context.cookies(['https://account.protonvpn.com', 'https://account.proton.me']);
    const jarCookie = pickCookiesFromJar(cookies);
    const uid = captured.uid || uidFromCookie(captured.cookie) || uidFromCookie(jarCookie);
    const cookie = relevantCookie(captured.cookie, uid) || relevantCookie(jarCookie, uid);

    if (captured.appVersion && uid && cookie) {
      return {
        appVersion: captured.appVersion,
        uid,
        cookie
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Timed out waiting for x-pm-appversion, x-pm-uid, and auth cookies after login.');
}

async function replayLogicalsRequest(appVersion, uid, cookie) {
  console.log('stage=logicals.fetch');
  const response = await fetch(LOGICALS_URL, {
    headers: {
      Accept: ACCEPT,
      'x-pm-appversion': appVersion,
      'x-pm-uid': uid,
      Cookie: cookie
    },
    signal: AbortSignal.timeout(45000)
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    body
  };
}

async function loginForSession({ username, password }) {
  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 50
  });
  let browserClosed = false;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const captured = createRequestCollector(page);
    let session;

    try {
      await loginIfNeeded(page, username, password);
      session = await waitForSessionMaterial(context, captured);
    } catch (error) {
      error.message = `${error.message} (current page: ${page.url()})`;
      throw error;
    }

    await browser.close();
    browserClosed = true;

    console.log(`stage=session.captured appVersion=${Boolean(session.appVersion)} uid=${Boolean(session.uid)} cookie=${Boolean(session.cookie)}`);

    if (!session.appVersion || !session.uid || !session.cookie) {
      throw new Error('Logged in, but required x-pm-appversion, x-pm-uid, or auth cookies were missing.');
    }

    return session;
  } finally {
    if (!browserClosed) {
      await browser.close();
    }
  }
}

async function getFreshSession() {
  if (!refreshPromise) {
    refreshPromise = loginForSession({
      username: requireCredential('PROTON_USERNAME', 'Username'),
      password: requireCredential('PROTON_PASSWORD', 'Password')
    })
      .then(async (session) => {
        sessionCache = session;
        await writeSessionCache(session);
        return session;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  sessionCache = await refreshPromise;
  return sessionCache;
}

async function fetchLogicalsWithSession(session) {
  const result = await replayLogicalsRequest(session.appVersion, session.uid, session.cookie);
  console.log(`stage=logicals.done status=${result.status}`);
  return result;
}

async function getLogicals() {
  let session = await readSessionCache();

  if (!session) {
    session = await getFreshSession();
  }

  let result = await fetchLogicalsWithSession(session);

  if (result.status === 401) {
    console.log('stage=session.expired');
    await deleteSessionCache();
    session = await getFreshSession();
    result = await fetchLogicalsWithSession(session);
  }

  return result;
}

app.get('/', async (_req, res, next) => {
  try {
    const result = await getLogicals();

    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    res.json(result.body);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || 'Unexpected error',
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

app.listen(port, () => {
  console.log(`ProtonVPN server fetcher listening on http://localhost:${port}`);
});
