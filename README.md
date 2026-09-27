# SpotifyNuke

Nuke an artist or song from your Spotify playlists. No fuss or hassle.

**Live at [spotifynuke.vercel.app](https://spotifynuke.vercel.app)**

1. Log in with Spotify.
2. Search for the artists and songs to nuke. Hover an artist (or tap **i**) to check it's the right one when several share a name.
3. Pick the playlists. Everything you can edit is selected, Liked Songs included.
4. Review the matches, untick anything to spare, and nuke. Changed your mind? Hit **Undo**.

## Using the live site

Spotify limits every hobby app to **5 approved users**, so there are two ways in:

| Button | Who it's for |
| --- | --- |
| **Log in with Spotify** | Accounts the site owner has approved. |
| **Not approved? Use it anyway** | Everyone else. You create your own free Spotify app and log in through it. |

### Using your own Spotify app

You need **Spotify Premium** (Spotify requires it for anyone who creates an app). It takes about 5 minutes, once.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in with your normal Spotify account.
2. Click **Create app**:
   - **Name / description:** anything.
   - **Redirect URI:** `https://spotifynuke.vercel.app/callback`, then click **Add**.
   - **Which API are you planning to use?** tick **Web API**.
   - Agree to the terms and **Save**.
3. Open **Settings → User Management** and add your name and Spotify email if it isn't listed.
4. Copy the **Client ID** from **Settings → Basic Information**, paste it into the site's guide and click **Log in with my app**.

The site remembers your Client ID in your browser, so next time it's one click. You never need to share your
Client Secret: own-app logins use Spotify's [PKCE flow](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow),
which only needs the public Client ID.

**Troubleshooting**

- *INVALID_CLIENT: Invalid client*: the Client ID is wrong.
- *INVALID_CLIENT: Invalid redirect URI*: the redirect URI on your app doesn't exactly match the one above.
- *Spotify rejected this account*: add your Spotify email under User Management.
- *Stopped working later*: your Premium subscription has lapsed.

## Features

- **Artists or songs, as many as you like.** Artist results show photos, and a hover card shows genres, latest releases and a link to the Spotify profile.
- **Keep rules.** Switch any chip from **Nuke** to **Keep** to protect it: nuke an artist but keep one song, or keep their collabs with someone else. Keep always wins.
- **Include features** (on by default): also removes songs where the artist is featured, not just the lead.
- **All versions of a song** (on by default): also catches remasters, live versions, remixes and single/album copies.
- **Review before anything is deleted,** grouped by playlist, with every match ticked.
- **Undo** puts songs back in their original positions.
- **Liked Songs** can be nuked alongside playlists.

## Limits

- Spotify only lets apps edit playlists you own or collaborate on. Other playlists are shown but locked.
- Local files can't be edited by apps and are skipped.
- Spotify's API doesn't expose artist bios, so the hover card shows photo, genres and releases instead.
- Undo only works until you leave or refresh the page. Liked Songs come back with today's date.

## How it's built

A small Express server with a plain HTML/CSS/JS front end. No framework and no database.

```
index.js          Express app: OAuth routes and the /api endpoints
lib/spotify.js    Spotify Web API client: token refresh, 429 retry, pagination
lib/session.js    Login state in an AES-256-GCM encrypted cookie (works on serverless)
lib/match.js      Nuke/keep matching rules
public/           The single-page front end
test/             Tests for the matching rules
```

- **Scanning** runs one request per playlist, three at a time, and the server returns only the matches with their positions.
- **Nuking** removes tracks in batches of 100 (40 for Liked Songs, per Spotify's limits).
- **Undo** re-inserts tracks in ascending position order, which rebuilds the original layout.
- Built against the Spotify Web API as of the [February 2026 changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) (`/playlists/{id}/items`, `/me/library`).

## Run your own copy

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and add the redirect URI
   `http://127.0.0.1:8888/callback` (use `127.0.0.1`, not `localhost`; Spotify no longer accepts `localhost` redirects).
2. Create `.env`:

   ```
   CLIENT_ID=your_client_id
   CLIENT_SECRET=your_client_secret
   REDIRECT_URI=http://127.0.0.1:8888/callback
   SESSION_SECRET=any_long_random_string
   ```

3. Install and run, then open http://127.0.0.1:8888:

   ```
   npm install
   npm start
   ```

Run the tests with `npm test`.

### Deploy to Vercel

1. Import the repo into Vercel. No build settings are needed: Vercel detects the Express app in `index.js` and serves `public/` from its CDN.
2. Add these environment variables:

   | Name | Value |
   | --- | --- |
   | `CLIENT_ID` | from the Spotify dashboard |
   | `CLIENT_SECRET` | from the Spotify dashboard |
   | `REDIRECT_URI` | `https://<your-domain>/callback` (must end in `/callback`) |
   | `SESSION_SECRET` | a long random string (required; it encrypts the login cookie) |

   Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Add the same `https://<your-domain>/callback` as a redirect URI in the Spotify dashboard.
4. Redeploy after changing environment variables.

### Custom nuke gif

Drop a `nuke.gif` into `public/` and it plays instead of the built-in animation.

## Why only 5 users?

Since February 2026, Spotify apps in Development Mode allow at most 5 allowlisted users, and the owner needs Premium.
Extended Quota (unlimited users) is only granted to registered businesses with 250k+ monthly active users.
The "use your own app" option exists so anyone with Premium can still use SpotifyNuke.
