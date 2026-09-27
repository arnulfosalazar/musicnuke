require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('./lib/session');
const spotify = require('./lib/spotify');
const { findMatch } = require('./lib/match');

const { CLIENT_ID, REDIRECT_URI } = process.env;
const PORT = process.env.PORT || 8888;
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify'
].join(' ');

const app = express();
app.use(express.json({ limit: '5mb' }));
// Local only; on Vercel, public/ is served straight from the CDN.
app.use(express.static(path.join(__dirname, 'public')));

// Picks the smallest image that is still at least `min` pixels wide.
function pickImage(images, min = 64) {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find(img => (img.width || 0) >= min) || sorted[sorted.length - 1]).url;
}

function simplifyTrack(track) {
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map(a => ({ id: a.id, name: a.name })),
    album: track.album?.name,
    image: pickImage(track.album?.images)
  };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------- Auth ----------

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  session.setState(res, state);
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    show_dialog: 'false'
  });
  res.redirect(`https://accounts.spotify.com/authorize?${query}`);
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = session.takeState(req, res);
  if (error) return res.redirect(`/?error=${encodeURIComponent(error)}`);
  if (!code || !state || state !== expected) return res.redirect('/?error=state_mismatch');

  try {
    session.setAuth(res, await spotify.exchangeCode(code));
    res.redirect('/');
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    res.redirect('/?error=login_failed');
  }
});

app.post('/logout', (req, res) => {
  session.clearAuth(res);
  res.json({ ok: true });
});

// ---------- API ----------

const api = express.Router();

api.use((req, res, next) => {
  const auth = session.getAuth(req);
  if (!auth) return res.status(401).json({ error: 'Not logged in' });
  req.auth = auth;

  // Re-issue the cookie when a token refresh happened during this request.
  const json = res.json.bind(res);
  res.json = body => {
    if (auth.changed && res.statusCode < 400) session.setAuth(res, auth);
    return json(body);
  };
  next();
});

api.get('/me', async (req, res) => {
  const me = await spotify.call(req.auth, 'get', '/me');
  if (req.auth.userId !== me.id) {
    req.auth.userId = me.id;
    req.auth.changed = true;
  }
  res.json({ id: me.id, name: me.display_name || me.id, image: pickImage(me.images) });
});

api.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ artists: [], tracks: [] });
  const data = await spotify.call(req.auth, 'get', '/search', {
    params: { q, type: 'artist,track', limit: 10 }
  });
  res.json({
    artists: (data.artists?.items || []).filter(Boolean).map(a => ({
      id: a.id,
      name: a.name,
      image: pickImage(a.images),
      genres: a.genres || []
    })),
    tracks: (data.tracks?.items || []).filter(Boolean).map(simplifyTrack)
  });
});

api.get('/artist/:id', async (req, res) => {
  const { id } = req.params;
  const [artist, albums] = await Promise.all([
    spotify.call(req.auth, 'get', `/artists/${id}`),
    spotify.call(req.auth, 'get', `/artists/${id}/albums`, {
      params: { include_groups: 'album,single', limit: 10 }
    }).catch(() => ({ items: [] }))
  ]);

  const seen = new Set();
  const releases = [];
  for (const album of albums.items || []) {
    const key = album.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    releases.push({
      name: album.name,
      year: album.release_date?.slice(0, 4),
      type: album.album_type,
      image: pickImage(album.images)
    });
  }

  res.json({
    id: artist.id,
    name: artist.name,
    image: pickImage(artist.images, 300),
    genres: artist.genres || [],
    url: artist.external_urls?.spotify,
    releases: releases.slice(0, 4)
  });
});

api.get('/playlists', async (req, res) => {
  const auth = req.auth;
  const me = auth.userId ? { id: auth.userId } : await spotify.call(auth, 'get', '/me');
  const playlists = await spotify.getAll(auth, '/me/playlists', { limit: 50 });
  const liked = await spotify.call(auth, 'get', '/me/tracks', { params: { limit: 1 } });

  res.json({
    liked: { id: 'liked', name: 'Liked Songs', count: liked.total, editable: true },
    playlists: playlists.filter(Boolean).map(p => ({
      id: p.id,
      name: p.name,
      count: p.items?.total ?? p.tracks?.total ?? 0,
      image: pickImage(p.images),
      owner: p.owner?.display_name || p.owner?.id,
      // Spotify only lets you edit playlists you own or collaborate on.
      editable: p.owner?.id === me.id || p.collaborative
    }))
  });
});

async function loadSource(auth, source) {
  if (source === 'liked') {
    const items = await spotify.getAll(auth, '/me/tracks', { limit: 50 });
    return items.map(it => ({ track: it.item || it.track, isLocal: false }));
  }
  const items = await spotify.getAll(auth, `/playlists/${source}/items`, {
    limit: 50,
    additional_types: 'track'
  });
  return items.map(it => ({ track: it.item || it.track, isLocal: it.is_local }));
}

// Scans one playlist (or Liked Songs) and returns the tracks the rules match.
api.post('/scan', async (req, res) => {
  const { source, targets, options = {} } = req.body;
  if (!source || !Array.isArray(targets)) throw spotify.httpError(400, 'Missing source or targets');

  const entries = await loadSource(req.auth, source);
  const byUri = new Map();
  let skippedLocal = 0;

  entries.forEach(({ track, isLocal }, position) => {
    if (isLocal) { skippedLocal++; return; }
    if (!track || track.type !== 'track' || !track.id) return;

    const rule = findMatch(track, targets, options);
    if (!rule) return;

    const existing = byUri.get(track.uri);
    if (existing) {
      existing.positions.push(position);
    } else {
      byUri.set(track.uri, { ...simplifyTrack(track), positions: [position], reason: rule.name });
    }
  });

  res.json({ total: entries.length, skippedLocal, matches: [...byUri.values()] });
});

api.post('/nuke', async (req, res) => {
  const { source, uris } = req.body;
  if (!source || !Array.isArray(uris)) throw spotify.httpError(400, 'Missing source or uris');
  const auth = req.auth;

  if (source === 'liked') {
    for (const group of chunk(uris, 40)) {
      await spotify.call(auth, 'delete', '/me/library', { params: { uris: group.join(',') } });
    }
  } else {
    for (const group of chunk(uris, 100)) {
      await spotify.call(auth, 'delete', `/playlists/${source}/items`, {
        data: { items: group.map(uri => ({ uri })) }
      });
    }
  }
  res.json({ removed: uris.length });
});

// Puts nuked tracks back where they were.
api.post('/restore', async (req, res) => {
  const { source, items } = req.body;
  if (!source || !Array.isArray(items)) throw spotify.httpError(400, 'Missing source or items');
  const auth = req.auth;

  if (source === 'liked') {
    for (const group of chunk(items.map(i => i.uri), 40)) {
      await spotify.call(auth, 'put', '/me/library', { params: { uris: group.join(',') } });
    }
    return res.json({ restored: items.length });
  }

  // Re-inserting in ascending position order rebuilds the original layout.
  // Consecutive positions are grouped into a single request.
  const placements = items
    .flatMap(i => i.positions.map(position => ({ uri: i.uri, position })))
    .sort((a, b) => a.position - b.position);

  const current = await spotify.call(auth, 'get', `/playlists/${source}/items`, { params: { limit: 1 } });
  let length = current.total;

  const runs = [];
  for (const p of placements) {
    const last = runs[runs.length - 1];
    if (last && p.position === last.start + last.uris.length && last.uris.length < 100) {
      last.uris.push(p.uri);
    } else {
      runs.push({ start: p.position, uris: [p.uri] });
    }
  }

  for (const run of runs) {
    const position = Math.min(run.start, length);
    await spotify.call(auth, 'post', `/playlists/${source}/items`, { data: { uris: run.uris, position } });
    length += run.uris.length;
  }
  res.json({ restored: placements.length });
});

app.use('/api', api);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (status === 401) session.clearAuth(res);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

// Vercel imports the app; locally we start the server ourselves.
if (require.main === module) {
  app.listen(PORT, () => console.log(`SpotifyNuke running on http://127.0.0.1:${PORT}`));
}

module.exports = app;
