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
const TOOLS_HTML = fs.readFileSync(path.join(__dirname, 'private', 'tools.html'), 'utf8');
const TOOLS_JS = fs.readFileSync(path.join(__dirname, 'private', 'tools.js'), 'utf8');
// The site's favicon address, read from index.html so there is one source of truth.
const FAVICON_HREF = (fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').match(/<link[^>]+rel="icon"[^>]*href="([^"]+)"/i)?.[1] || '').replace(/&amp;/g, '&');

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
  if (!db.bioProfiles || typeof db.bioProfiles !== 'object' || Array.isArray(db.bioProfiles)) db.bioProfiles = {};
  return db;
}
async function saveDb(db) {
  if (USE_REDIS) return void (await redis(['SET', DB_KEY, JSON.stringify(db)]));
  if (ON_VERCEL) throw new Error('Storage is not set up. In Vercel, open Storage, add Upstash Redis, connect it to this project and redeploy.');
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Use a configured canonical origin in production; never build OAuth URLs from
// attacker-controlled Host / X-Forwarded-* headers.
const SITE_ORIGIN = process.env.SITE_ORIGIN
  ? new URL(process.env.SITE_ORIGIN).origin
  : (ON_VERCEL ? 'https://brzyx.vercel.app' : '');
function origin(req = { headers: {} }) {
  if (SITE_ORIGIN) return SITE_ORIGIN;
  const host = String(req?.headers?.host || 'localhost').toLowerCase();
  const localHost = host === 'localhost' || host === '127.0.0.1'
    || host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
  return localHost ? `http://${host}` : 'http://localhost:' + PORT;
}
const isSecure = () => SITE_ORIGIN.startsWith('https://');
const redirectUri = () => REDIRECT_OVERRIDE || `${origin()}/auth/discord`;
const spotifyRedirectUri = () => SPOTIFY_REDIRECT_OVERRIDE || `${origin()}/auth/spotify`;

function requireSameOrigin(req, res, next) {
  const requestOrigin = req.get('origin');
  const expectedOrigin = SITE_ORIGIN || origin(req);
  if (!requestOrigin) return res.status(403).json({ error: 'Origin header required.' });
  try {
    if (new URL(requestOrigin).origin !== expectedOrigin) {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  next();
}

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
  if (isSecure()) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [].concat(prev, parts.join('; ')));
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '200kb', inflate: false }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (ON_VERCEL) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// Cookie-authenticated state changes must originate from this exact site.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return requireSameOrigin(req, res, next);
  next();
});

// Express 4 does not catch rejected promises; this forwards them to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getSession(req) {
  return readToken(parseCookies(req).session);
}
const isAdmin = (s) => !!s && ADMIN_IDS.includes(s.id);
// Any signed-in Discord user (not just admins).
function requireUser(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Sign in with Discord to use Tools.' });
  req.session = s;
  next();
}
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
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: spotifyRedirectUri() }),
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
    redirect_uri: spotifyRedirectUri(),
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
    redirect_uri: redirectUri(),
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
        redirect_uri: redirectUri(),
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
  const db = await loadDb();
  // Only expose fields used by the public website. Never serialize private
  // collections (for example bioProfiles and their ownerId values).
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    profile: {
      name: str(db.profile?.name, 80),
      tagline: str(db.profile?.tagline, 240),
      avatar: typeof db.profile?.avatar === 'string' ? db.profile.avatar : ''
    },
    pastwork: Array.isArray(db.pastwork) ? db.pastwork : [],
    projects: Array.isArray(db.projects) ? db.projects : [],
    contacts: Array.isArray(db.contacts) ? db.contacts : [],
    clients: Array.isArray(db.clients) ? db.clients : [],
    reviews: Array.isArray(db.reviews) ? db.reviews : [],
    settings: {
      maintenance: !!db.settings?.maintenance,
      maintenanceMessage: str(db.settings?.maintenanceMessage, 240),
      globalMessage: db.settings?.globalMessage && typeof db.settings.globalMessage === 'object'
        ? { id: str(db.settings.globalMessage.id, 80), text: str(db.settings.globalMessage.text, 240), type: ['info', 'success', 'warning'].includes(db.settings.globalMessage.type) ? db.settings.globalMessage.type : 'info', updatedAt: Number(db.settings.globalMessage.updatedAt) || 0 }
        : null,
      refreshAt: Number(db.settings?.refreshAt) || 0
    }
  });
}));

// --- Tools: only sent to signed-in Discord users ---
app.get('/tools/tools.html', requireUser, (req, res) => res.type('html').set('Cache-Control', 'no-store').send(TOOLS_HTML));

app.get('/tools/tools.js', requireUser, (req, res) => res.type('js').set('Cache-Control', 'no-store').send(TOOLS_JS));

// --- Public bio link pages ---
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);
function cleanPublicUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch { return ''; }
}
function publicProfileHtml(profile) {
  const name = escapeHtml(profile.name || profile.username);
  const username = escapeHtml(profile.username);
  const bio = escapeHtml(profile.bio || '');
  const accent = /^#[0-9a-f]{6}$/i.test(profile.accent) ? profile.accent : '#a78bfa';
  const links = (profile.links || []).filter((item) => item.title && cleanPublicUrl(item.url));
  const projects = (profile.projects || []).filter((item) => item.title && cleanPublicUrl(item.url));
  const linkCards = links.map((item) => {
    const href = cleanPublicUrl(item.url);
    const favicon = 'https://www.google.com/s2/favicons?domain_url=' + encodeURIComponent(href) + '&sz=64';
    return `<a class="link-card spotlight-card" data-spotlight href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><span class="spotlight-light" aria-hidden="true"></span><span class="spotlight-grain" aria-hidden="true"></span><span class="spotlight-content"><img src="${favicon}" alt="" loading="lazy"><span>${escapeHtml(item.title)}</span><span class="arrow">↗</span></span><span class="spotlight-edge" aria-hidden="true"></span></a>`;
  }).join('');
  const projectCards = projects.map((item) => {
    const href = cleanPublicUrl(item.url);
    const favicon = 'https://www.google.com/s2/favicons?domain_url=' + encodeURIComponent(href) + '&sz=64';
    let host = '';
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch {}
    return `<a class="project-card spotlight-card" data-spotlight href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><span class="spotlight-light" aria-hidden="true"></span><span class="spotlight-grain" aria-hidden="true"></span><span class="spotlight-content"><img src="${favicon}" alt="" loading="lazy"><span class="project-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(host)}</small></span><span class="arrow">↗</span></span><span class="spotlight-edge" aria-hidden="true"></span></a>`;
  }).join('');
  const hasProjects = projects.length > 0;
  const initial = escapeHtml((profile.name || profile.username || '?').trim().charAt(0).toUpperCase());
  const avatarMarkup = profile.avatar && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(profile.avatar) && profile.avatar.length <= 150000 ? `<img src="${profile.avatar}" alt="${name} profile picture">` : initial;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08080b"><meta name="description" content="${bio || name + ' on BRZYX'}"><meta property="og:title" content="${name} — BRZYX"><meta property="og:description" content="${bio}"><title>${name} (@${username}) — BRZYX</title><link rel="icon" href="/favicon-image"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;--accent:${accent}}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#08080b;color:#f7f7fa;font-family:"DM Sans",Inter,system-ui,sans-serif;overflow-x:hidden}.ambient{position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 0%,color-mix(in srgb,var(--accent) 20%,transparent),transparent 48%),radial-gradient(ellipse at 10% 80%,#3730a322,transparent 40%);animation:ambient 12s ease-in-out infinite alternate}.grain{position:fixed;inset:0;pointer-events:none;opacity:.035;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E")}main{position:relative;width:min(100% - 32px,460px);margin:0 auto;padding:9vh 0 40px;animation:rise .8s cubic-bezier(.2,.8,.2,1) both}.profile{text-align:center;margin-bottom:28px}.avatar{width:82px;height:82px;margin:0 auto 17px;display:grid;place-items:center;overflow:hidden;border-radius:28px;border:1px solid color-mix(in srgb,var(--accent) 65%,white 10%);background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 28%,#17171d),#111116);box-shadow:0 12px 55px color-mix(in srgb,var(--accent) 22%,transparent);font-size:30px;font-weight:800}.avatar img{width:100%;height:100%;object-fit:cover}.name{font-size:26px;font-weight:800;letter-spacing:-.8px;margin:0}.username{font-size:13px;color:#777782;margin-top:6px}.bio{font-size:14px;line-height:1.7;color:#a4a4ae;max-width:350px;margin:15px auto 0;white-space:pre-wrap}.tabs{display:grid;grid-template-columns:1fr ${hasProjects ? '1fr' : '0fr'};gap:7px;margin:25px 0 13px}.tab{border:1px solid #ffffff14;background:#ffffff08;color:#a8a8b2;border-radius:13px;padding:11px;font:600 12px "DM Sans",sans-serif;cursor:pointer;transition:.25s}.tab.active{background:var(--accent);color:#0a0a0d;border-color:transparent}.content{display:grid;gap:10px}.content[hidden]{display:none}.link-card,.project-card{--spotlight-card-surface:#111111;--spotlight-card-border:rgba(255,255,255,.08);--spotlight-card-shadow:0 24px 48px -24px rgba(0,0,0,.6);position:relative;isolation:isolate;display:flex;align-items:center;gap:13px;min-height:62px;padding:12px 15px;border:1px solid var(--spotlight-card-border);border-radius:17px;background:var(--spotlight-card-surface);box-shadow:var(--spotlight-card-shadow);color:#f7f7fa;text-decoration:none;overflow:hidden;transition:transform .25s,border-color .25s,background .25s;backdrop-filter:blur(14px)}.link-card:hover,.project-card:hover{transform:translateY(-2px)}.spotlight-light,.spotlight-edge,.spotlight-grain{pointer-events:none;position:absolute;inset:0;border-radius:inherit}.spotlight-light{z-index:0;opacity:0;background:radial-gradient(circle 240px at var(--spot-x,50%) var(--spot-y,50%),rgba(255,255,255,.15),rgba(255,255,255,.08) 35%,transparent 70%)}.spotlight-grain{z-index:0;opacity:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:160px 160px;mix-blend-mode:overlay}.spotlight-edge{z-index:2;padding:1px;border:1px solid transparent;background:radial-gradient(circle 145px at var(--spot-x,50%) var(--spot-y,50%),rgba(255,255,255,.7),rgba(255,255,255,.08) 65%,transparent 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;opacity:0}.spotlight-content{position:relative;z-index:1;display:flex;align-items:center;gap:13px;width:100%;min-width:0}.link-card img,.project-card img{position:relative;z-index:1}.link-card img,.project-card img{width:27px;height:27px;object-fit:contain;border-radius:8px;background:#ffffff0b;padding:4px}.link-card span:nth-child(2){font-size:13px;font-weight:700;flex:1;text-align:center;margin-left:-30px}.arrow{color:#777782;font-size:16px;margin-left:auto}.project-copy{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.project-copy strong{font-size:13px}.project-copy small{font-size:11px;color:#777782}.empty{padding:25px;text-align:center;color:#777782;border:1px dashed #ffffff20;border-radius:16px;font-size:12px}.footer{text-align:center;margin-top:34px;color:#555560;font-size:10px;letter-spacing:2px;font-weight:700}.footer a{color:#777782;text-decoration:none}.spotlight:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(250px circle at var(--x,50%) var(--y,50%),color-mix(in srgb,var(--accent) 17%,transparent),transparent 70%);opacity:0;transition:opacity .25s}.spotlight:hover:before{opacity:1}@keyframes rise{from{opacity:0;transform:translateY(18px);filter:blur(8px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}@keyframes ambient{to{transform:scale(1.12) translateY(2%);opacity:.7}}@media(prefers-reduced-motion:reduce){*,*:before{animation:none!important;transition:none!important}}
</style></head><body><div class="ambient"></div><div class="grain"></div><main><header class="profile"><div class="avatar">${avatarMarkup}</div><h1 class="name">${name}</h1><div class="username">@${username}</div>${bio ? `<p class="bio">${bio}</p>` : ''}</header>${hasProjects ? '<nav class="tabs"><button class="tab active" data-tab="links">Links</button><button class="tab" data-tab="projects">Past projects</button></nav>' : ''}<section id="links" class="content">${linkCards || '<div class="empty">No links added yet.</div>'}</section>${hasProjects ? `<section id="projects" class="content" hidden>${projectCards}</section>` : ''}<footer class="footer">MADE WITH <a href="/" rel="noopener">BRZYX</a><div style="margin-top:9px;font-size:9px;letter-spacing:1px;font-weight:500">INTERACTIONS INSPIRED BY <a href="https://reactbits.dev/components/spotlight-card" target="_blank" rel="noopener noreferrer">REACT BITS</a></div></footer></main>
<script>
document.querySelectorAll('[data-spotlight]').forEach(card=>{
  const light=card.querySelector('.spotlight-light'),edge=card.querySelector('.spotlight-edge'),grain=card.querySelector('.spotlight-grain');
  const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
  let targetX=0,targetY=0,x=0,y=0,presence=0,frame=0,pressed=false,active=false,last=0;
  const tick=now=>{
    frame=0;const dt=Math.min(.05,Math.max(.001,(now-last)/1000));last=now;
    const ease=reduce?1:1-Math.exp(-dt/.09);
    x+=(targetX-x)*ease;y+=(targetY-y)*ease;
    const target=active?1:0;
    presence+=(target-presence)*(reduce?1:1-Math.exp(-dt/(target>presence?.1:.32)));
    card.style.setProperty('--spot-x',x+'px');card.style.setProperty('--spot-y',y+'px');
    light.style.opacity=String(Math.min(1,presence*.15*(pressed?1.7:1)));
    edge.style.opacity=String(Math.min(1,presence*.6*(pressed?1.7:1)));
    grain.style.opacity=String(presence*0);
    if(Math.abs(targetX-x)>.1||Math.abs(targetY-y)>.1||Math.abs(target-presence)>.002)frame=requestAnimationFrame(tick);
  };
  const wake=()=>{if(!frame){last=performance.now();frame=requestAnimationFrame(tick)}};
  const move=e=>{const r=card.getBoundingClientRect();targetX=e.clientX-r.left;targetY=e.clientY-r.top;active=true;wake()};
  const leave=()=>{pressed=false;active=false;wake()};
  card.addEventListener('pointermove',move);
  card.addEventListener('pointerleave',leave);
  card.addEventListener('pointerdown',()=>{pressed=true;wake()});
  card.addEventListener('pointerup',()=>{pressed=false;wake()});
  card.addEventListener('focus',()=>{const r=card.getBoundingClientRect();targetX=r.width/2;targetY=r.height/2;active=true;wake()});
  card.addEventListener('blur',leave);
});
document.querySelectorAll('[data-tab]').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.content').forEach(x=>x.hidden=x.id!==tab.dataset.tab)}));
</script></body></html>`;
}

app.get('/api/biolink/mine', requireUser, wrap(async (req, res) => {
  const db = await loadDb();
  const entry = Object.entries(db.bioProfiles || {}).find(([, item]) => item.ownerId === req.session.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json(entry ? { published: true, username: entry[0], url: origin(req) + '/p/' + encodeURIComponent(entry[0]), updatedAt: entry[1].updatedAt } : { published: false });
}));

app.post('/api/biolink/publish', requireUser, wrap(async (req, res) => {
  const username = str(req.body.username, 24).toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 characters using letters, numbers or underscores.' });
  const name = str(req.body.name, 40);
  if (!name) return res.status(400).json({ error: 'Add a display name before publishing.' });
  const accent = /^#[0-9a-f]{6}$/i.test(req.body.accent) ? req.body.accent : '#a78bfa';
  const cleanItems = (items, max, titleMax) => (Array.isArray(items) ? items.slice(0, max) : []).map((item) => ({
    title: str(item?.title, titleMax),
    url: cleanPublicUrl(item?.url)
  })).filter((item) => item.title && item.url);
  const avatar = typeof req.body.avatar === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(req.body.avatar) && req.body.avatar.length <= 150000 ? req.body.avatar : '';
  if (req.body.avatar && !avatar) return res.status(400).json({ error: 'Profile picture must be a PNG, JPG or WebP under 110 KB.' });
  const profile = {
    username, name, bio: str(req.body.bio, 140), accent, avatar,
    links: cleanItems(req.body.links, 8, 28),
    projects: cleanItems(req.body.projects, 12, 40),
    ownerId: req.session.id,
    updatedAt: Date.now()
  };
  const db = await loadDb();
  db.bioProfiles ||= {};
  const existing = db.bioProfiles[username];
  if (existing && existing.ownerId !== req.session.id) return res.status(409).json({ error: 'That username is already taken. Choose another one.' });
  for (const [slug, item] of Object.entries(db.bioProfiles)) {
    if (item.ownerId === req.session.id && slug !== username) delete db.bioProfiles[slug];
  }
  db.bioProfiles[username] = profile;
  await saveDb(db);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, username, url: origin(req) + '/p/' + encodeURIComponent(username) });
}));

app.delete('/api/biolink/publish', requireUser, wrap(async (req, res) => {
  const db = await loadDb();
  db.bioProfiles ||= {};
  const owned = Object.entries(db.bioProfiles).filter(([, item]) => item.ownerId === req.session.id);
  if (!owned.length) return res.status(404).json({ error: 'You do not have a published page.' });
  owned.forEach(([slug]) => delete db.bioProfiles[slug]);
  await saveDb(db);
  res.json({ ok: true });
}));

app.get('/p/:username', wrap(async (req, res) => {
  const username = String(req.params.username || '').toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(404).send('Page not found');
  const db = await loadDb();
  const profile = db.bioProfiles?.[username];
  if (!profile) return res.status(404).type('html').send('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found — BRZYX</title></head><body style="margin:0;background:#08080b;color:#fff;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><div style="text-align:center"><h1>404</h1><p>This BRZYX page does not exist.</p><a style="color:#aaa" href="/">Back to BRZYX</a></div></body></html>');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.type('html').send(publicProfileHtml(profile));
}));


// Same-origin copy of the site favicon so tools can draw it onto exported images (canvas needs CORS-safe images).
let faviconCache = null;
app.get('/favicon-image', wrap(async (req, res) => {
  if (!FAVICON_HREF) return res.status(404).end();
  if (!/^https?:\/\//i.test(FAVICON_HREF)) return res.redirect(FAVICON_HREF);
  if (!faviconCache) {
    const r = await fetch(FAVICON_HREF);
    if (!r.ok) return res.status(502).end();
    faviconCache = { type: r.headers.get('content-type') || 'image/png', data: Buffer.from(await r.arrayBuffer()) };
  }
  res.type(faviconCache.type).set('Cache-Control', 'public, max-age=86400').send(faviconCache.data);
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
    db.settings.refreshAt = Math.max(Date.now(), Number(db.settings.refreshAt || 0) + 1);
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
  const allowedTypes = new Set([...Object.keys(SCHEMAS), 'clients']);
  if (!allowedTypes.has(type)) return res.status(404).json({ error: 'Unknown section' });
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
  console.error('Request failed:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// Vercel imports the app; locally we start a server.
if (!ON_VERCEL) app.listen(PORT, () => console.log(`brzy-portfolio running at http://localhost:${PORT}`));

export default app;
