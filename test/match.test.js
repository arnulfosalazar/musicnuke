const test = require('node:test');
const assert = require('node:assert');
const { findMatch, normalizeTitle } = require('../lib/match');

const drake = { id: 'drake', name: 'Drake' };
const rihanna = { id: 'rihanna', name: 'Rihanna' };
const track = (id, name, ...artists) => ({ id, name, artists });

const defaults = { primaryOnly: false, allVersions: true };

test('normalizeTitle strips version noise', () => {
  assert.equal(normalizeTitle('Hold On - 2011 Remaster'), 'hold on');
  assert.equal(normalizeTitle('Hold On (Live) [feat. Someone]'), 'hold on');
  assert.equal(normalizeTitle("Don't Stop"), 'don t stop');
});

test('artist nuke matches lead and featured appearances', () => {
  const targets = [{ type: 'artist', id: 'drake', name: 'Drake', mode: 'nuke' }];
  assert.ok(findMatch(track('1', 'A', drake), targets, defaults));
  assert.ok(findMatch(track('2', 'B', rihanna, drake), targets, defaults));
  assert.equal(findMatch(track('3', 'C', rihanna), targets, defaults), null);
});

test('primaryOnly ignores features', () => {
  const targets = [{ type: 'artist', id: 'drake', name: 'Drake', mode: 'nuke' }];
  const opts = { ...defaults, primaryOnly: true };
  assert.ok(findMatch(track('1', 'A', drake), targets, opts));
  assert.equal(findMatch(track('2', 'B', rihanna, drake), targets, opts), null);
});

test('song nuke catches other versions only when enabled', () => {
  const targets = [{ type: 'track', id: 'orig', name: 'Hotline Bling', artistIds: ['drake'], mode: 'nuke' }];
  const remaster = track('other', 'Hotline Bling - Remastered', drake);
  const cover = track('cover', 'Hotline Bling', rihanna);
  assert.ok(findMatch(remaster, targets, defaults));
  assert.equal(findMatch(remaster, targets, { ...defaults, allVersions: false }), null);
  assert.equal(findMatch(cover, targets, defaults), null);
});

test('keep rules override nuke rules', () => {
  const targets = [
    { type: 'artist', id: 'drake', name: 'Drake', mode: 'nuke' },
    { type: 'artist', id: 'rihanna', name: 'Rihanna', mode: 'keep' },
    { type: 'track', id: 'fav', name: 'Favorite', artistIds: ['drake'], mode: 'keep' }
  ];
  assert.equal(findMatch(track('1', 'Work', rihanna, drake), targets, defaults), null);
  assert.equal(findMatch(track('fav', 'Favorite', drake), targets, defaults), null);
  assert.equal(findMatch(track('x', 'Favorite (Live)', drake), targets, defaults), null);
  assert.equal(findMatch(track('2', 'Other', drake), targets, defaults).name, 'Drake');
});
