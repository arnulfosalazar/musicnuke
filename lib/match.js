// Strips version noise so "Song - 2011 Remaster", "Song (Live)" and
// "Song [feat. X]" all reduce to "song".
function normalizeTitle(name) {
  return name
    .toLowerCase()
    .replace(/\s+-\s+.*$/, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function matchesArtist(track, artistId, primaryOnly) {
  if (primaryOnly) return track.artists[0]?.id === artistId;
  return track.artists.some(a => a.id === artistId);
}

function matchesTrack(track, target, allVersions) {
  if (track.id === target.id) return true;
  if (!allVersions) return false;
  const sharesArtist = track.artists.some(a => target.artistIds.includes(a.id));
  return sharesArtist && normalizeTitle(track.name) === normalizeTitle(target.name);
}

function ruleMatches(track, rule, options, isKeep) {
  if (rule.type === 'artist') {
    // A "keep" artist protects every song they appear on, features included.
    return matchesArtist(track, rule.id, !isKeep && options.primaryOnly);
  }
  return matchesTrack(track, rule, options.allVersions);
}

// Returns the nuke rule that matches `track`, or null when nothing matches
// or a keep rule protects it.
function findMatch(track, targets, options) {
  const keeps = targets.filter(t => t.mode === 'keep');
  if (keeps.some(rule => ruleMatches(track, rule, options, true))) return null;
  return targets.find(t => t.mode !== 'keep' && ruleMatches(track, t, options, false)) || null;
}

module.exports = { findMatch, normalizeTitle };
