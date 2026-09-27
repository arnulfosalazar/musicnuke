const $ = sel => document.querySelector(sel);

const state = {
  me: null,
  targets: [],      // { type, id, name, image, sub, mode: 'nuke'|'keep', artistIds? }
  sources: null,    // Liked Songs + playlists, loaded once per run
  selected: new Set(),
  scan: [],         // [{ source, matches: [{ ...track, positions, reason, selected }] }]
  skippedLocal: 0,
  lastNuke: []      // [{ source, items }] successfully removed, for undo
};

// ---------- Helpers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function thumb(src, { round = false, label = '' } = {}) {
  const cls = `thumb${round ? ' round' : ''}`;
  if (src) return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">`;
  return `<div class="${cls} placeholder">${esc(label.charAt(0).toUpperCase())}</div>`;
}

async function api(path, body) {
  const res = await fetch(`/api${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) {
    state.me = null;
    showLogin('Your session expired. Log in again to continue.');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function show(name) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${name}`; });
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

// Runs `fn` over `items` with at most `limit` in flight at once.
async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

function setProgress(title, fraction, label) {
  $('#progress-title').textContent = title;
  $('#progress-bar').style.width = `${Math.round(fraction * 100)}%`;
  $('#progress-label').textContent = label;
}

// ---------- Auth ----------

function showLogin(message) {
  $('#user').hidden = true;
  const err = $('#login-error');
  err.hidden = !message;
  err.textContent = message || '';
  show('login');
}

const LOGIN_ERRORS = {
  access_denied: 'Spotify login was cancelled.',
  state_mismatch: 'Login check failed. Please try again.',
  login_failed: 'Could not log in with Spotify. Check the app credentials and redirect URI.'
};

async function init() {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  if (error) history.replaceState(null, '', '/');

  try {
    state.me = await api('/me');
  } catch (err) {
    if (err.status === 403) {
      // Development-mode Spotify apps reject accounts not on the allowlist.
      await fetch('/logout', { method: 'POST' });
      showLogin("Your Spotify account hasn't been approved for this app yet. Ask the owner to add you.");
    } else {
      showLogin(error && (LOGIN_ERRORS[error] || `Login failed: ${error}`));
    }
    return;
  }

  $('#user-name').textContent = state.me.name;
  const avatar = $('#user-avatar');
  if (state.me.image) avatar.src = state.me.image; else avatar.hidden = true;
  $('#user').hidden = false;
  show('targets');
  $('#search').focus();
}

$('#logout').addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' });
  state.me = null;
  showLogin();
});

// ---------- Step 1: search & targets ----------

const searchInput = $('#search');
const resultsEl = $('#results');
let searchSeq = 0;
let searchTimer;
let resultItems = [];
let activeIndex = -1;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value.trim()), 250);
});

searchInput.addEventListener('focus', () => {
  if (resultItems.length && searchInput.value.trim()) resultsEl.hidden = false;
});

searchInput.addEventListener('keydown', e => {
  if (resultsEl.hidden && e.key !== 'Enter') return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    setActive((activeIndex + step + resultItems.length) % resultItems.length);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = resultItems[activeIndex] || resultItems[0];
    if (item) addTarget(item);
  } else if (e.key === 'Escape') {
    closeResults();
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search') && !e.target.closest('#hovercard')) closeResults();
});

async function runSearch(q) {
  const seq = ++searchSeq;
  if (!q) { closeResults(); return; }
  try {
    const data = await api(`/search?q=${encodeURIComponent(q)}`);
    if (seq === searchSeq) renderResults(data);
  } catch (err) {
    if (seq === searchSeq) toast(err.message);
  }
}

function renderResults({ artists, tracks }) {
  resultItems = [
    ...artists.map(a => ({
      type: 'artist', id: a.id, name: a.name, image: a.image,
      sub: a.genres.slice(0, 2).join(', ') || 'Artist'
    })),
    ...tracks.map(t => ({
      type: 'track', id: t.id, name: t.name, image: t.image,
      sub: `${t.artists.map(a => a.name).join(', ')} · ${t.album || 'Single'}`,
      artistIds: t.artists.map(a => a.id)
    }))
  ];
  activeIndex = -1;

  if (!resultItems.length) {
    resultsEl.innerHTML = '<div class="empty">No matches. Try a different spelling.</div>';
    resultsEl.hidden = false;
    return;
  }

  const row = (item, i) => `
    <div class="result" data-index="${i}">
      ${thumb(item.image, { round: item.type === 'artist', label: item.name })}
      <div class="result-text">
        <div class="result-title">${esc(item.name)}</div>
        <div class="result-sub">${esc(item.sub)}</div>
      </div>
      ${item.type === 'artist' ? '<button class="info-btn" title="About this artist" aria-label="About this artist">i</button>' : ''}
    </div>`;

  const artistRows = resultItems.filter(i => i.type === 'artist');
  const trackRows = resultItems.filter(i => i.type === 'track');
  resultsEl.innerHTML =
    (artistRows.length ? `<h3>Artists</h3>${artistRows.map(item => row(item, resultItems.indexOf(item))).join('')}` : '') +
    (trackRows.length ? `<h3>Songs</h3>${trackRows.map(item => row(item, resultItems.indexOf(item))).join('')}` : '');
  resultsEl.hidden = false;
}

function setActive(index) {
  activeIndex = index;
  resultsEl.querySelectorAll('.result').forEach(el => {
    const on = Number(el.dataset.index) === index;
    el.classList.toggle('active', on);
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

function closeResults() {
  resultsEl.hidden = true;
  hideCard();
}

resultsEl.addEventListener('click', e => {
  const rowEl = e.target.closest('.result');
  if (!rowEl) return;
  const item = resultItems[Number(rowEl.dataset.index)];
  if (e.target.closest('.info-btn')) {
    e.stopPropagation();
    if (cardFor === item.id && !card.hidden) hideCard(); else showCard(item, rowEl);
    return;
  }
  addTarget(item);
});

function addTarget(item) {
  if (state.targets.some(t => t.type === item.type && t.id === item.id)) {
    toast(`${item.name} is already on the list.`);
  } else {
    state.targets.push({ ...item, mode: 'nuke' });
    renderChips();
  }
  searchInput.value = '';
  closeResults();
  resultItems = [];
  searchInput.focus();
}

function renderChips() {
  $('#chips').innerHTML = state.targets.map((t, i) => `
    <li class="chip">
      ${thumb(t.image, { round: true, label: t.name })}
      <span class="chip-name" title="${esc(t.name)}">${esc(t.name)}</span>
      <span class="chip-type">${t.type === 'artist' ? 'Artist' : 'Song'}</span>
      <button class="mode ${t.mode === 'keep' ? 'keep' : ''}" data-mode="${i}"
        title="${t.mode === 'keep' ? 'Protected: songs matching this are kept' : 'Songs matching this get nuked'}">
        ${t.mode === 'keep' ? 'Keep' : 'Nuke'}
      </button>
      <button class="chip-x" data-remove="${i}" aria-label="Remove ${esc(t.name)}">×</button>
    </li>`).join('');

  $('#chips-hint').hidden = state.targets.length === 0;
  $('#to-playlists').disabled = !state.targets.some(t => t.mode === 'nuke');
}

$('#chips').addEventListener('click', e => {
  const modeBtn = e.target.closest('[data-mode]');
  const removeBtn = e.target.closest('[data-remove]');
  if (modeBtn) {
    const t = state.targets[Number(modeBtn.dataset.mode)];
    t.mode = t.mode === 'keep' ? 'nuke' : 'keep';
  } else if (removeBtn) {
    state.targets.splice(Number(removeBtn.dataset.remove), 1);
  } else {
    return;
  }
  renderChips();
});

// ---------- Artist hover card ----------

const card = $('#hovercard');
const artistCache = new Map();
let cardFor = null;
let showTimer;
let hideTimer;

resultsEl.addEventListener('mouseover', e => {
  const rowEl = e.target.closest('.result');
  if (!rowEl || e.target.closest('.info-btn')) return;
  const item = resultItems[Number(rowEl.dataset.index)];
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  if (item?.type !== 'artist') { hideTimer = setTimeout(hideCard, 150); return; }
  if (cardFor === item.id && !card.hidden) return;
  showTimer = setTimeout(() => showCard(item, rowEl), 350);
});

resultsEl.addEventListener('mouseleave', () => {
  clearTimeout(showTimer);
  hideTimer = setTimeout(hideCard, 200);
});
card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
card.addEventListener('mouseleave', () => { hideTimer = setTimeout(hideCard, 200); });

function hideCard() {
  clearTimeout(showTimer);
  card.hidden = true;
  cardFor = null;
}

function positionCard(rowEl) {
  const row = rowEl.getBoundingClientRect();
  const box = resultsEl.getBoundingClientRect();
  const width = 280;
  let left;
  let top;

  const fitsRight = box.right + 12 + width < window.innerWidth;
  const fitsLeft = box.left - 12 - width > 0;
  // Without side room, sit below the dropdown so the card never hides the
  // other same-named artists you're comparing against.
  card.classList.toggle('compact', !fitsRight && !fitsLeft);

  if (fitsRight) {
    left = box.right + 12;
    top = row.top - 20;
  } else if (fitsLeft) {
    left = box.left - 12 - width;
    top = row.top - 20;
  } else {
    left = Math.max(16, box.right - width);
    top = box.bottom + 8;
  }
  const height = card.offsetHeight || 300;
  top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

async function showCard(item, rowEl) {
  cardFor = item.id;
  card.innerHTML = `
    ${item.image ? `<img class="hc-photo" src="${esc(item.image)}" alt="">` : '<div class="hc-photo"></div>'}
    <div class="hc-body"><p class="hc-name">${esc(item.name)}</p><p class="muted">Loading…</p></div>`;
  card.hidden = false;
  positionCard(rowEl);

  let artist = artistCache.get(item.id);
  if (!artist) {
    try {
      artist = await api(`/artist/${item.id}`);
      artistCache.set(item.id, artist);
    } catch {
      if (cardFor === item.id) card.querySelector('.muted').textContent = 'Could not load artist details.';
      return;
    }
  }
  if (cardFor !== item.id) return;

  card.innerHTML = `
    ${artist.image ? `<img class="hc-photo" src="${esc(artist.image)}" alt="">` : ''}
    <div class="hc-body">
      <p class="hc-name">${esc(artist.name)}</p>
      ${artist.genres.length
        ? `<div class="tags">${artist.genres.slice(0, 4).map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>`
        : ''}
      ${artist.releases.length ? `
        <p class="hc-label">Latest releases</p>
        ${artist.releases.map(r => `
          <div class="hc-release">
            ${r.image ? `<img src="${esc(r.image)}" alt="">` : ''}
            <div class="result-text">
              <div class="result-title">${esc(r.name)}</div>
              <span>${esc([r.type === 'single' ? 'Single' : 'Album', r.year].filter(Boolean).join(' · '))}</span>
            </div>
          </div>`).join('')}` : '<p class="muted">No releases found.</p>'}
      ${artist.url ? `<a class="hc-link" href="${esc(artist.url)}" target="_blank" rel="noopener">View full profile on Spotify ↗</a>` : ''}
    </div>`;
  positionCard(rowEl);
}

// ---------- Step 2: playlists ----------

$('#to-playlists').addEventListener('click', async () => {
  show('playlists');
  if (!state.sources) await loadPlaylists();
  renderPlaylists();
});

async function loadPlaylists() {
  $('#playlists').innerHTML = '<li class="muted pad">Loading playlists…</li>';
  $('#scan').disabled = true;
  $('#pl-count').textContent = '';
  try {
    const { liked, playlists } = await api('/playlists');
    state.sources = [liked, ...playlists];
    state.selected = new Set(state.sources.filter(s => s.editable).map(s => s.id));
  } catch (err) {
    $('#playlists').innerHTML = `<li class="error pad">${esc(err.message)}</li>`;
    throw err;
  }
}

function renderPlaylists() {
  if (!state.sources) return;
  const filter = $('#pl-filter').value.trim().toLowerCase();
  const visible = state.sources.filter(s => !filter || s.name.toLowerCase().includes(filter));

  $('#playlists').innerHTML = visible.length ? visible.map(s => `
    <li class="row ${s.editable ? '' : 'locked'}" data-id="${esc(s.id)}"
      ${s.editable ? '' : 'title="Spotify only lets apps edit playlists you own or collaborate on."'}>
      <input type="checkbox" ${state.selected.has(s.id) ? 'checked' : ''} ${s.editable ? '' : 'disabled'} tabindex="-1">
      ${s.id === 'liked' ? '<div class="thumb liked-art">♥</div>' : thumb(s.image, { label: s.name })}
      <div class="result-text">
        <div class="result-title">${esc(s.name)}</div>
        <div class="result-sub">${plural(s.count, 'song')}${s.owner && s.id !== 'liked' ? ` · ${esc(s.owner)}` : ''}</div>
      </div>
      ${s.editable ? '' : '<span class="badge">Not yours</span>'}
    </li>`).join('') : '<li class="muted pad">No playlists match that filter.</li>';

  updateScanButton();
}

function updateScanButton() {
  const n = state.selected.size;
  $('#pl-count').textContent = n ? `(${plural(n, 'playlist')})` : '';
  $('#scan').disabled = n === 0;
}

$('#playlists').addEventListener('click', e => {
  const rowEl = e.target.closest('.row');
  if (!rowEl || rowEl.classList.contains('locked')) return;
  const id = rowEl.dataset.id;
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  rowEl.querySelector('input').checked = state.selected.has(id);
  updateScanButton();
});

$('#pl-filter').addEventListener('input', renderPlaylists);

function visibleEditable() {
  const filter = $('#pl-filter').value.trim().toLowerCase();
  return state.sources.filter(s => s.editable && (!filter || s.name.toLowerCase().includes(filter)));
}
$('#pl-all').addEventListener('click', () => { visibleEditable().forEach(s => state.selected.add(s.id)); renderPlaylists(); });
$('#pl-none').addEventListener('click', () => { visibleEditable().forEach(s => state.selected.delete(s.id)); renderPlaylists(); });

document.querySelectorAll('[data-go]').forEach(btn => {
  btn.addEventListener('click', () => show(btn.dataset.go));
});

// ---------- Scan ----------

$('#scan').addEventListener('click', async () => {
  const sources = state.sources.filter(s => state.selected.has(s.id));
  const targets = state.targets.map(({ type, id, name, mode, artistIds }) => ({ type, id, name, mode, artistIds }));
  const options = {
    primaryOnly: !$('#opt-features').checked,
    allVersions: $('#opt-versions').checked
  };

  show('progress');
  setProgress('Scanning your playlists…', 0, `0 of ${plural(sources.length, 'playlist')}`);

  const results = new Map();
  const errors = [];
  let done = 0;

  await pool(sources, 3, async source => {
    try {
      const res = await api('/scan', { source: source.id, targets, options });
      results.set(source.id, { source, ...res });
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
    }
    done++;
    setProgress('Scanning your playlists…', done / sources.length, `${done} of ${sources.length} · ${source.name}`);
  });

  if (!state.me) return;

  // Keep the original playlist order regardless of which scan finished first.
  const ordered = sources.map(s => results.get(s.id)).filter(Boolean);
  state.skippedLocal = ordered.reduce((sum, r) => sum + r.skippedLocal, 0);
  state.scan = ordered
    .filter(r => r.matches.length)
    .map(r => ({ source: r.source, matches: r.matches.map(m => ({ ...m, selected: true })) }));

  renderReview(errors);
  show('review');
});

// ---------- Review ----------

function selectedCount() {
  return state.scan.reduce((sum, g) => sum + g.matches.filter(m => m.selected).length, 0);
}

function renderReview(errors = []) {
  const total = state.scan.reduce((sum, g) => sum + g.matches.length, 0);
  const notes = [];
  if (state.skippedLocal) notes.push(`${plural(state.skippedLocal, 'local file')} skipped (Spotify doesn't let apps edit those).`);
  errors.forEach(e => notes.push(`Couldn't scan ${e}`));

  if (!total) {
    $('#review-title').textContent = 'Nothing to nuke';
    $('#review-sub').textContent = "None of the selected playlists have those songs or artists.";
    $('#review-list').innerHTML = notes.map(n => `<p class="hint">${esc(n)}</p>`).join('');
    $('#nuke').hidden = true;
    return;
  }

  $('#nuke').hidden = false;
  $('#review-title').textContent = `Found ${plural(total, 'song')} in ${plural(state.scan.length, 'playlist')}`;
  $('#review-sub').textContent = 'Everything is set to go. Untick anything you want to keep.';

  $('#review-list').innerHTML = notes.map(n => `<p class="hint">${esc(n)}</p>`).join('') +
    state.scan.map((g, gi) => `
      <details class="group" ${gi < 5 ? 'open' : ''}>
        <summary>
          <input type="checkbox" data-group="${gi}">
          ${g.source.id === 'liked' ? '<div class="thumb liked-art">♥</div>' : thumb(g.source.image, { label: g.source.name })}
          <div class="result-text">
            <div class="group-name">${esc(g.source.name)}</div>
            <div class="group-count" data-count="${gi}"></div>
          </div>
        </summary>
        <ul class="tracks">
          ${g.matches.map((m, mi) => `
            <li class="row" data-g="${gi}" data-m="${mi}">
              <input type="checkbox" ${m.selected ? 'checked' : ''} tabindex="-1">
              ${thumb(m.image, { label: m.name })}
              <div class="result-text">
                <div class="result-title">${esc(m.name)}${m.positions.length > 1 ? ` <span class="chip-type">×${m.positions.length}</span>` : ''}</div>
                <div class="result-sub">${esc(m.artists.map(a => a.name).join(', '))}</div>
              </div>
              <span class="reason" title="Matched ${esc(m.reason)}">${esc(m.reason)}</span>
            </li>`).join('')}
        </ul>
      </details>`).join('');

  refreshReviewCounts();
}

function refreshReviewCounts() {
  state.scan.forEach((g, gi) => {
    const on = g.matches.filter(m => m.selected).length;
    const box = document.querySelector(`[data-group="${gi}"]`);
    box.checked = on === g.matches.length;
    box.indeterminate = on > 0 && on < g.matches.length;
    document.querySelector(`[data-count="${gi}"]`).textContent = `${on} of ${plural(g.matches.length, 'song')} selected`;
  });
  const n = selectedCount();
  $('#nuke').disabled = n === 0;
  $('#nuke').textContent = n ? `Nuke ${plural(n, 'song')}` : 'Nothing selected';
}

$('#review-list').addEventListener('click', e => {
  const groupBox = e.target.closest('[data-group]');
  if (groupBox) {
    // Toggle the whole playlist without also collapsing the <details>.
    e.preventDefault();
    const g = state.scan[Number(groupBox.dataset.group)];
    const next = !g.matches.every(m => m.selected);
    g.matches.forEach(m => { m.selected = next; });
    document.querySelectorAll(`.row[data-g="${groupBox.dataset.group}"] input`).forEach(i => { i.checked = next; });
    setTimeout(refreshReviewCounts);
    return;
  }
  const rowEl = e.target.closest('.row[data-g]');
  if (!rowEl) return;
  const m = state.scan[Number(rowEl.dataset.g)].matches[Number(rowEl.dataset.m)];
  m.selected = !m.selected;
  rowEl.querySelector('input').checked = m.selected;
  refreshReviewCounts();
});

// ---------- Nuke ----------

$('#nuke').addEventListener('click', async () => {
  const jobs = state.scan
    .map(g => ({ source: g.source, items: g.matches.filter(m => m.selected) }))
    .filter(j => j.items.length);
  const total = jobs.reduce((sum, j) => sum + j.items.length, 0);

  show('progress');
  setProgress('Nuking…', 0, `0 of ${plural(total, 'song')}`);

  const removed = [];
  const errors = [];
  let done = 0;

  await pool(jobs, 2, async job => {
    try {
      await api('/nuke', { source: job.source.id, uris: job.items.map(i => i.uri) });
      removed.push(job);
    } catch (err) {
      errors.push(`${job.source.name}: ${err.message}`);
    }
    done += job.items.length;
    setProgress('Nuking…', done / total, `${done} of ${total} · ${job.source.name}`);
  });

  if (!state.me) return;

  state.lastNuke = removed;
  state.sources = null; // song counts changed
  const count = removed.reduce((sum, j) => sum + j.items.length, 0);

  if (!count) {
    showDone({ blast: false, title: 'Nothing was removed', sub: 'Spotify rejected every request.', errors });
    return;
  }
  showDone({
    blast: true,
    title: 'Nuked.',
    sub: `${plural(count, 'song')} gone from ${plural(removed.length, 'playlist')}.`,
    errors
  });
});

// ---------- Done / undo ----------

let hasGif;
async function nukeGifAvailable() {
  if (hasGif === undefined) {
    hasGif = await fetch('/nuke.gif', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
  }
  return hasGif;
}

async function playBlast() {
  const blast = $('#blast');
  if (await nukeGifAvailable()) {
    blast.innerHTML = `<img class="gif" src="/nuke.gif?${Date.now()}" alt="Nuclear explosion">`;
  } else {
    blast.innerHTML = `
      <div class="ground"></div>
      <div class="stem"></div>
      <div class="ring"></div>
      <div class="cap"><div class="puff"></div><div class="puff"></div><div class="puff"></div><div class="puff"></div></div>`;
  }
  blast.hidden = false;

  const flash = document.createElement('div');
  flash.className = 'flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1000);
}

function showDone({ blast, title, sub, errors = [] }) {
  $('#blast').hidden = true;
  $('#blast').innerHTML = '';
  $('#done-title').textContent = title;
  $('#done-sub').textContent = sub;
  $('#done-errors').innerHTML = errors.map(e => `<li>Failed: ${esc(e)}</li>`).join('');
  $('#undo').hidden = !state.lastNuke.length;
  show('done');
  if (blast) playBlast();
}

$('#undo').addEventListener('click', async () => {
  const jobs = state.lastNuke;
  const total = jobs.reduce((sum, j) => sum + j.items.length, 0);

  show('progress');
  setProgress('Putting everything back…', 0, `0 of ${plural(total, 'song')}`);

  const errors = [];
  let done = 0;
  let restored = 0;

  await pool(jobs, 2, async job => {
    try {
      await api('/restore', {
        source: job.source.id,
        items: job.items.map(i => ({ uri: i.uri, positions: i.positions }))
      });
      restored += job.items.length;
    } catch (err) {
      errors.push(`${job.source.name}: ${err.message}`);
    }
    done += job.items.length;
    setProgress('Putting everything back…', done / total, `${done} of ${total} · ${job.source.name}`);
  });

  if (!state.me) return;

  const hadLiked = jobs.some(j => j.source.id === 'liked');
  state.lastNuke = [];
  showDone({
    blast: false,
    title: 'Undone.',
    sub: `${plural(restored, 'song')} put back where they were.` +
      (hadLiked ? ' Liked Songs come back with today’s date.' : ''),
    errors
  });
});

$('#again').addEventListener('click', () => {
  state.targets = [];
  state.scan = [];
  state.lastNuke = [];
  renderChips();
  show('targets');
  searchInput.focus();
});

init();
