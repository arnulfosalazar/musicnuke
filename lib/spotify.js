const axios = require('axios');

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Tokens live server-side, keyed by session id, so they never reach the browser.
const tokenStore = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestToken(params) {
  const basic = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(TOKEN_URL, new URLSearchParams(params), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`
    }
  });
  return res.data;
}

function saveTokens(sid, data) {
  const prev = tokenStore.get(sid) || {};
  const auth = {
    ...prev,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || prev.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    refreshing: null
  };
  tokenStore.set(sid, auth);
  return auth;
}

async function exchangeCode(sid, code) {
  return saveTokens(sid, await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.REDIRECT_URI
  }));
}

async function getToken(sid) {
  const auth = tokenStore.get(sid);
  if (!auth) throw httpError(401, 'Not logged in');
  if (Date.now() < auth.expiresAt) return auth.accessToken;

  // Share one refresh between concurrent requests.
  if (!auth.refreshing) {
    auth.refreshing = requestToken({ grant_type: 'refresh_token', refresh_token: auth.refreshToken })
      .then(data => saveTokens(sid, data))
      .catch(() => {
        tokenStore.delete(sid);
        throw httpError(401, 'Session expired, please log in again');
      });
  }
  return (await auth.refreshing).accessToken;
}

async function call(sid, method, path, { params, data } = {}, attempt = 0) {
  const token = await getToken(sid);
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
      return call(sid, method, path, { params, data }, attempt + 1);
    }
    if (status === 401 && attempt < 1) {
      const auth = tokenStore.get(sid);
      if (auth) auth.expiresAt = 0;
      return call(sid, method, path, { params, data }, attempt + 1);
    }
    if (status >= 500 && attempt < 3) {
      await sleep(1000 * (attempt + 1));
      return call(sid, method, path, { params, data }, attempt + 1);
    }

    const message = err.response?.data?.error?.message || err.message;
    throw httpError(status || 500, `Spotify: ${message}`);
  }
}

// Follows `next` links until every page of a paginated endpoint is loaded.
async function getAll(sid, path, params) {
  const items = [];
  let page = await call(sid, 'get', path, { params });
  items.push(...page.items);
  while (page.next) {
    page = await call(sid, 'get', page.next);
    items.push(...page.items);
  }
  return items;
}

function logout(sid) {
  tokenStore.delete(sid);
}

function isLoggedIn(sid) {
  return tokenStore.has(sid);
}

module.exports = { call, getAll, exchangeCode, logout, isLoggedIn, httpError };
