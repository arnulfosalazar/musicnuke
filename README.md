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

## Deploy to Vercel

1. Import the repo into Vercel. No build settings are needed; Vercel detects the Express app in `index.js` and serves `public/` from its CDN.
2. Add these environment variables in the Vercel project settings:

   | Name | Value |
   | --- | --- |
   | `CLIENT_ID` | from the Spotify dashboard |
   | `CLIENT_SECRET` | from the Spotify dashboard |
   | `REDIRECT_URI` | `https://<your-domain>/callback` |
   | `SESSION_SECRET` | a long random string (required; it encrypts the login cookie) |

   Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Add `https://<your-domain>/callback` as a redirect URI in the Spotify dashboard (keep the `127.0.0.1` one for local dev).
4. Redeploy after changing environment variables.

## Who can log in

Spotify apps in Development Mode allow at most **5 users**, and the app owner needs Spotify Premium.
Add each person's Spotify email under **User Management** in the dashboard. Anyone else sees
"Your Spotify account hasn't been approved for this app yet." Spotify only grants Extended Quota
(unlimited users) to registered businesses with 250k+ monthly active users.

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
