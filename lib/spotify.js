const axios = require('axios');

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// With `ownClientId` the request uses PKCE (client_id in the body, no
// secret); otherwise it authenticates as this site's app.
async function requestToken(params, ownClientId) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (ownClientId) {
    params = { ...params, client_id: ownClientId };
  } else {
    const basic = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }
  const res = await axios.post(TOKEN_URL, new URLSearchParams(params), { headers });
  return res.data;
}

function applyTokens(auth, data) {
  auth.accessToken = data.access_token;
  auth.refreshToken = data.refresh_token || auth.refreshToken;
  auth.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  auth.changed = true;
  return auth;
}

// `own` is { clientId, verifier } for logins through the user's own app.
async function exchangeCode(code, own) {
  const params = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.REDIRECT_URI
  };
  if (own) params.code_verifier = own.verifier;
  const auth = own ? { clientId: own.clientId } : {};
  return applyTokens(auth, await requestToken(params, own?.clientId));
}

// `auth` is the per-request login state. A refresh updates it in place and
// flags it as changed so the caller can re-issue the cookie.
async function getToken(auth) {
  if (Date.now() < auth.expiresAt) return auth.accessToken;

  // Share one refresh between concurrent calls in the same request.
  if (!auth.refreshing) {
    auth.refreshing = requestToken({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }, auth.clientId)
      .then(data => applyTokens(auth, data))
      .catch(() => { throw httpError(401, 'Session expired, please log in again'); })
      .finally(() => { auth.refreshing = null; });
  }
  await auth.refreshing;
  return auth.accessToken;
}

async function refreshIfExpiring(auth, withinMs) {
  if (auth.expiresAt - Date.now() < withinMs) auth.expiresAt = 0;
  await getToken(auth);
}

async function call(auth, method, path, { params, data } = {}, attempt = 0) {
  const token = await getToken(auth);
  try {
    const res = await axios({
      method,
      url: path.startsWith('http') ? path : API + path,
      params,
      data,
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;

    if (status === 429 && attempt < 6) {
      const retryAfter = Number(err.response.headers['retry-after']) || 1;
      if (retryAfter > 60) throw httpError(429, 'Spotify is rate limiting this app. Try again in a few minutes.');
      await sleep(retryAfter * 1000 + 250);
      return call(auth, method, path, { params, data }, attempt + 1);
    }
    if (status === 401 && attempt < 1) {
      auth.expiresAt = 0;
      return call(auth, method, path, { params, data }, attempt + 1);
    }
    if (status >= 500 && attempt < 3) {
      await sleep(1000 * (attempt + 1));
      return call(auth, method, path, { params, data }, attempt + 1);
    }

    const message = err.response?.data?.error?.message || err.message;
    throw httpError(status || 500, `Spotify: ${message}`);
  }
}

// Follows `next` links until every page of a paginated endpoint is loaded.
async function getAll(auth, path, params) {
  const items = [];
  let page = await call(auth, 'get', path, { params });
  items.push(...page.items);
  while (page.next) {
    page = await call(auth, 'get', page.next);
    items.push(...page.items);
  }
  return items;
}

module.exports = { call, getAll, exchangeCode, refreshIfExpiring, httpError };
