import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- tiny .env loader for local use (Vercel injects env vars itself) ---
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const ON_VERCEL = !!process.env.VERCEL;
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Optional override. Normally the redirect address is built from the site being visited.
const REDIRECT_OVERRIDE = process.env.DISCORD_REDIRECT_URI || '';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set: logins will not survive restarts or work across serverless instances.');

// --- files read once at startup (literal paths so Vercel bundles them) ---
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'seed.json'), 'utf8'));
const PANEL_HTML = fs.readFileSync(path.join(__dirname, 'private', 'panel.html'), 'utf8');
const PANEL_JS = fs.readFileSync(path.join(__dirname, 'private', 'panel.js'), 'utf8');

// --- storage: Upstash Redis (REST) when configured, local JSON file otherwise ---
// Vercel integrations may prefix Redis variables with the database name
// (for example BRZYX_KV_REST_API_URL). Support both prefixed and standard names.
function findRedisEnv(suffix) {
  const direct = process.env[suffix];
  if (direct) return direct;
  const match = Object.entries(process.env).find(([key, value]) =>
    value && key.endsWith(`_${suffix}`)
  );
  return match?.[1] || '';
}
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  findRedisEnv('KV_REST_API_URL') ||
  '';
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  findRedisEnv('KV_REST_API_TOKEN') ||
  '';
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);
const DB_KEY = 'brzy:db';
const DB_FILE = path.join(__dirname, 'data', 'db.json');

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Storage error (${r.status})`);
  return d.result;
}
async function loadDb() {
  let db;
  if (USE_REDIS) {
    const raw = await redis(['GET', DB_KEY]);
    db = raw ? { ...structuredClone(SEED), ...JSON.parse(raw) } : structuredClone(SEED);
  } else if (!ON_VERCEL && fs.existsSync(DB_FILE)) {
    db = { ...structuredClone(SEED), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } else {
    db = structuredClone(SEED);
  }
  // Add newly introduced collections to databases created by older versions.
  for (const [key, value] of Object.entries(SEED)) {
    if (Array.isArray(value) && !Array.isArray(db[key])) db[key] = [];
  }
  if (!db.profile) db.profile = structuredClone(SEED.profile);
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  db.settings = { maintenance: false, maintenanceMessage: 'We are performing scheduled maintenance. Please check back soon.', globalMessage: null, refreshAt: 0, ...db.settings };
  return db;
}
async function saveDb(db) {
  if (USE_REDIS) return void (await redis(['SET', DB_KEY, JSON.stringify(db)]));
  if (ON_VERCEL) throw new Error('Storage is not set up. In Vercel, open Storage, add Upstash Redis, connect it to this project and redeploy.');
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// The public address of this site as the visitor sees it (works behind Vercel's proxy).
function origin(req) {
  const first = (v) => String(v || '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol || 'http';
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}
const isSecure = (req) => origin(req).startsWith('https://');
const redirectUri = (req) => REDIRECT_OVERRIDE || `${origin(req)}/auth/discord`;

// --- signed cookies ---
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = Buffer.from(sign(body));
  const given = Buffer.from(sig || '');
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp && p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const parseCookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
function setCookie(req, res, name, value, maxAgeSec) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isSecure(req)) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [].concat(prev, parts.join('; ')));
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Express 4 does not catch rejected promises; this forwards them to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getSession(req) {
  return readToken(parseCookies(req).session);
}
const isAdmin = (s) => !!s && ADMIN_IDS.includes(s.id);
function requireAdmin(req, res, next) {
  const s = getSession(req);
  if (!isAdmin(s)) return res.status(403).json({ error: 'Not authorized' });
  req.session = s;
  next();
}

// --- Spotify connection and playback --- 
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_REDIRECT_OVERRIDE = process.env.SPOTIFY_REDIRECT_URI || '';
const spotifyRedirectUri = (req) => SPOTIFY_REDIRECT_OVERRIDE || `${origin(req)}/auth/spotify`;

app.get('/auth/spotify', async (req, res) => {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return res.status(503).send('Spotify is not configured yet. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel.');
  if (req.query.code) {
    const saved = readToken(parseCookies(req).spotify_oauth_state);
    if (!saved || saved.state !== req.query.state) return res.redirect('/?spotify=failed');
    try {
      const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: spotifyRedirectUri(req) }),
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok || !tokens.refresh_token) return res.redirect('/?spotify=failed');
      const payload = { refreshToken: tokens.refresh_token, accessToken: tokens.access_token, accessExp: Date.now() + (tokens.expires_in || 3600) * 1000 - 60000, exp: Date.now() + 30 * 24 * 3600 * 1000 };
      setCookie(req, res, 'spotify_session', makeToken(payload), 30 * 24 * 3600);
      setCookie(req, res, 'spotify_oauth_state', '', 0);
      return res.redirect('/');
    } catch (e) {
      console.error('Spotify OAuth failed:', e.message);
      return res.redirect('/?spotify=failed');
    }
  }
  if (req.query.error) return res.redirect('/');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(req, res, 'spotify_oauth_state', makeToken({ state, exp: Date.now() + 10 * 60 * 1000 }), 600);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri(req),
    scope: 'user-read-currently-playing user-read-playback-state playlist-read-private',
    state,
  }).toString();
  res.redirect(url.toString());
});

async function spotifyAccess(req, res) {
  const session = readToken(parseCookies(req).spotify_session);
  if (!session?.refreshToken) return null;
  if (session.accessToken && session.accessExp > Date.now()) return session.accessToken;
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;
  session.accessToken = data.access_token;
  session.accessExp = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
  if (data.refresh_token) session.refreshToken = data.refresh_token;
  setCookie(req, res, 'spotify_session', makeToken(session), Math.max(60, Math.floor((session.exp - Date.now()) / 1000)));
  return session.accessToken;
}

app.get('/api/spotify/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ connected: !!readToken(parseCookies(req).spotify_session)?.refreshToken, configured: !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) });
});
app.get('/api/spotify/playlists', wrap(async (req, res) => {
  const token = await spotifyAccess(req, res);
  if (!token) return res.status(401).json({ error: 'Connect Spotify first.' });
  const r = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: 'Could not load Spotify playlists.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items: (data.items || []).map((p) => ({ id: p.id, name: p.name, uri: p.uri, image: p.images?.[0]?.url || '' })) });
}));
app.get('/api/spotify/now-playing', wrap(async (req, res) => {
  const token = await spotifyAccess(req, res);
  if (!token) return res.status(401).json({ playing: false });
  const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 204) return res.json({ playing: false });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.item) return res.json({ playing: false });
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    playing: !!data.is_playing,
    contextUri: data.context?.uri || '',
    track: data.item.name || '',
    artist: (data.item.artists || []).map((a) => a.name).join(', '),
    image: data.item.album?.images?.[0]?.url || '',
    url: data.item.external_urls?.spotify || '',
  });
}));
app.post('/api/spotify/disconnect', (req, res) => {
  setCookie(req, res, 'spotify_session', '', 0);
  res.json({ ok: true });
});

// --- Discord login ---
function startLogin(req, res) {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).send('Discord login is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(req, res, 'oauth_state', makeToken({ state, exp: Date.now() + 10 * 60 * 1000 }), 600);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(req),
    scope: 'identify',
    state,
  }).toString();
  res.redirect(url.toString());
}

async function handleCallback(req, res) {
  try {
    const saved = readToken(parseCookies(req).oauth_state);
    if (!saved || !req.query.state || saved.state !== req.query.state || !req.query.code) return res.redirect('/?login=failed');
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: redirectUri(req),
      }),
    });
    if (!tokenRes.ok) return res.redirect('/?login=failed');
    const { access_token } = await tokenRes.json();
    const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) return res.redirect('/?login=failed');
    const u = await meRes.json();
    const avatar = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256` : '';
    const session = { id: u.id, name: u.global_name || u.username, avatar, exp: Date.now() + 7 * 24 * 3600 * 1000 };
    setCookie(req, res, 'session', makeToken(session), 7 * 24 * 3600);
    if (ADMIN_IDS.includes(u.id) && avatar) {
      // Best effort: a storage problem must not block logging in.
      try {
        const db = await loadDb();
        if (db.profile.avatar !== avatar) {
          db.profile.avatar = avatar;
          await saveDb(db);
        }
      } catch (e) {
        console.warn('Could not save profile avatar:', e.message);
      }
    }
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.redirect('/?login=failed');
  }
}

// Discord sends people back to this same URL with ?code=..., so one route does both jobs.
app.get('/auth/discord', (req, res) => (req.query.code || req.query.error ? handleCallback(req, res) : startLogin(req, res)));

app.post('/auth/logout', (req, res) => {
  setCookie(req, res, 'session', '', 0);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const s = getSession(req);
  res.json({ user: s ? { id: s.id, name: s.name, avatar: s.avatar } : null, isAdmin: isAdmin(s) });
});

// --- public content ---
app.get('/api/content', wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await loadDb());
}));

// --- admin-only panel assets (never sent to anyone else) ---
app.get('/admin/panel.html', requireAdmin, (req, res) => res.type('html').set('Cache-Control', 'no-store').send(PANEL_HTML));
app.get('/admin/panel.js', requireAdmin, (req, res) => res.type('js').set('Cache-Control', 'no-store').send(PANEL_JS));


app.post('/api/admin/settings', requireAdmin, wrap(async (req, res) => {
  const db = await loadDb();
  const action = str(req.body.action, 32);
  db.settings ||= { maintenance: false, maintenanceMessage: '', globalMessage: null, refreshAt: 0 };
  if (action === 'maintenance') {
    db.settings.maintenance = !!req.body.enabled;
    db.settings.maintenanceMessage = str(req.body.message, 240) || 'We are performing scheduled maintenance. Please check back soon.';
  } else if (action === 'global-message') {
    const message = str(req.body.message, 240);
    if (!message) return res.status(400).json({ error: 'Enter a message first.' });
    db.settings.globalMessage = { id: crypto.randomUUID(), text: message, type: ['info', 'success', 'warning'].includes(req.body.type) ? req.body.type : 'info', updatedAt: Date.now() };
  } else if (action === 'clear-message') {
    db.settings.globalMessage = null;
  } else if (action === 'refresh') {
    db.settings.refreshAt = Date.now();
  } else return res.status(400).json({ error: 'Unknown website control.' });
  await saveDb(db);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, settings: db.settings });
}));

// --- admin API ---
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
function url(v, { allowMail = false } = {}) {
  const s = str(v, 500);
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  if (allowMail && /^(mailto:|tel:)/i.test(s)) return s;
  return null;
}
const SCHEMAS = {
  pastwork: (b) => {
    const image = url(b.image), link = url(b.link);
    if (!str(b.title) || image === null || link === null) return null;
    return { title: str(b.title, 120), description: str(b.description, 600), image, link };
  },
  projects: (b) => {
    const image = url(b.image), link = url(b.link);
    if (!str(b.title) || image === null || link === null) return null;
    const tags = (Array.isArray(b.tags) ? b.tags : str(b.tags).split(',')).map((t) => str(t, 24)).filter(Boolean).slice(0, 6);
    return { title: str(b.title, 120), description: str(b.description, 600), image, link, tags };
  },
  contacts: (b) => {
    const link = url(b.url, { allowMail: true });
    if (!str(b.label) || link === null) return null;
    return { label: str(b.label, 60), value: str(b.value, 120), url: link };
  },
  reviews: (b) => {
    const rating = Math.max(1, Math.min(5, Number(b.rating) || 5));
    const avatar = url(b.avatar);
    if (!str(b.name) || !str(b.quote) || avatar === null) return null;
    return { name: str(b.name, 80), avatar, role: str(b.role, 100), quote: str(b.quote, 600), rating };
  },
};
const BAD_FIELDS = 'Check the fields: a title is required and links must start with http(s).';

app.post('/api/admin/clients', requireAdmin, wrap(async (req, res) => {
  const m = String(req.body.invite || '').trim().match(/(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)?([A-Za-z0-9-]{2,32})\/?$/);
  if (!m) return res.status(400).json({ error: 'Enter a valid Discord invite link or code.' });
  let info;
  try {
    info = await fetchInvite(m[1]);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const db = await loadDb();
  if (db.clients.some((c) => c.guildId === info.guildId)) return res.status(409).json({ error: 'That server is already in Clients.' });
  const item = { id: crypto.randomUUID(), invite: `https://discord.gg/${m[1]}`, code: m[1], ...info, updatedAt: Date.now() };
  db.clients.push(item);
  await saveDb(db);
  res.json(item);
}));

app.post('/api/admin/clients/:id/refresh', requireAdmin, wrap(async (req, res) => {
  const db = await loadDb();
  const c = db.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  try {
    Object.assign(c, await fetchInvite(c.code), { updatedAt: Date.now() });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await saveDb(db);
  res.json(c);
}));

app.post('/api/admin/:type', requireAdmin, wrap(async (req, res) => {
  const make = SCHEMAS[req.params.type];
  if (!make) return res.status(404).json({ error: 'Unknown section' });
  const item = make(req.body);
  if (!item) return res.status(400).json({ error: BAD_FIELDS });
  const db = await loadDb();
  const full = { id: crypto.randomUUID(), ...item };
  db[req.params.type].push(full);
  await saveDb(db);
  res.json(full);
}));

app.put('/api/admin/:type/:id', requireAdmin, wrap(async (req, res) => {
  const make = SCHEMAS[req.params.type];
  if (!make) return res.status(404).json({ error: 'Unknown section' });
  const item = make(req.body);
  if (!item) return res.status(400).json({ error: BAD_FIELDS });
  const db = await loadDb();
  const i = db[req.params.type].findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  db[req.params.type][i] = { id: req.params.id, ...item };
  await saveDb(db);
  res.json(db[req.params.type][i]);
}));

app.delete('/api/admin/:type/:id', requireAdmin, wrap(async (req, res) => {
  const type = req.params.type;
  const db = await loadDb();
  if (!Array.isArray(db[type])) return res.status(404).json({ error: 'Unknown section' });
  const before = db[type].length;
  db[type] = db[type].filter((x) => x.id !== req.params.id);
  if (db[type].length === before) return res.status(404).json({ error: 'Not found' });
  await saveDb(db);
  res.json({ ok: true });
}));

async function fetchInvite(code) {
  const r = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`);
  if (r.status === 404) throw new Error('That invite does not exist or has expired.');
  if (!r.ok) throw new Error(`Discord returned ${r.status}. Try again in a moment.`);
  const d = await r.json();
  if (!d.guild) throw new Error('That invite does not point to a server.');
  return {
    guildId: d.guild.id,
    name: d.guild.name,
    icon: d.guild.icon ? `https://cdn.discordapp.com/icons/${d.guild.id}/${d.guild.icon}.png?size=128` : '',
    members: d.approximate_member_count ?? 0,
    online: d.approximate_presence_count ?? 0,
  };
}

// Local only: on Vercel, public/ is served by the CDN.
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// Vercel imports the app; locally we start a server.
if (!ON_VERCEL) app.listen(PORT, () => console.log(`brzy-portfolio running at http://localhost:${PORT}`));

export default app;
