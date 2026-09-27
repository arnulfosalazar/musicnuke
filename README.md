# SpotifyNuke

Nuke an artist or song from your Spotify playlists. No fuss or hassle.

1. Log in with Spotify.
2. Search for the artists and songs to nuke. Hover an artist (or tap **i**) to check it's the right one.
   Switch a chip to **Keep** to protect it, e.g. nuke an artist but keep one song or their features with someone else.
3. Pick the playlists (everything you can edit is selected, Liked Songs included).
4. Review the matches, untick anything to spare, and nuke. Changed your mind? Hit **Undo**.

## Setup

1. Create an app at https://developer.spotify.com/dashboard and add this redirect URI:
   `http://127.0.0.1:8888/callback`
2. Create `.env`:

   ```
   CLIENT_ID=your_client_id
   CLIENT_SECRET=your_client_secret
   REDIRECT_URI=http://127.0.0.1:8888/callback
   SESSION_SECRET=any_long_random_string
   ```

3. Install and run:

   ```
   npm install
   npm start
   ```

   Open http://127.0.0.1:8888 (use `127.0.0.1`, not `localhost`; Spotify no longer accepts `localhost` redirects).

While the Spotify app is in Development Mode, only users added under **User Management** in the dashboard can log in.

## Options

- **Include features**: on by default. Turn off to only remove songs where the artist is the lead.
- **All versions of a song**: on by default. Also removes remasters, live versions, remixes and duplicate single/album copies by the same artist.

## Custom nuke gif

Drop a `nuke.gif` into `public/` and it plays instead of the built-in animation.

## Limits

- Spotify only lets apps edit playlists you own or collaborate on. Other playlists are shown but locked.
- Local files can't be edited by apps and are skipped.
- Spotify's API doesn't expose artist bios, so the hover card shows photo, genres and latest releases, plus a link to the full profile.
- Undo only works until you leave or refresh the page. Liked Songs come back with today's date.

## Tests

```
npm test
```
