# brzy-portfolio

Portfolio with a notch navbar, a ColorBends WebGL background, separate click-through pages (Home, Past Work, Projects, Contact; nothing scrolls) and a Discord-gated admin panel. Tailwind (CDN) and vanilla JS on the front end, a small Express app on the back end. No React.

## Deploy on Vercel

1. Import the repo into Vercel.
2. Storage tab: add **Upstash Redis** and connect it to the project. This sets the `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` variables.
3. Environment Variables:

   | Name | Value |
   |---|---|
   | `BASE_URL` | `https://brzyx.vercel.app` (your live URL, no trailing slash) |
   | `DISCORD_CLIENT_ID` | from the Discord developer portal |
   | `DISCORD_CLIENT_SECRET` | from the Discord developer portal |
   | `ADMIN_IDS` | your Discord user ID (comma-separate more than one) |
   | `SESSION_SECRET` | a long random string |

4. Discord developer portal, OAuth2 -> Redirects: add `https://brzyx.vercel.app/auth/discord`. The only scope used is `identify`.
5. Redeploy, then open `https://brzyx.vercel.app/api/content`. You should see JSON. If you see a 404, the server isn't running (check that the project has no custom Output Directory or Framework override that conflicts with `vercel.json`).

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env`, fill it in, and add `http://localhost:3000/auth/discord` as a second Discord redirect.
3. `npm start`, then open http://localhost:3000. Without Redis variables, edits are saved to `data/db.json`.

## Admin panel

Sign in with Discord. If your user ID is in `ADMIN_IDS`, an **Admin** button appears in the notch. Other users, and signed-out visitors, never receive the panel's markup or script: the server returns 403 for them, and every `/api/admin/*` route checks the signed session.

Tabs: Past Work, Projects, Contacts, Clients. For Clients, paste a Discord invite; the server fetches the server name, icon and member count. Use Refresh to update the count. Clients show at the bottom of the home page.

## Notes

- Fonts: SF Pro and SF Compact only. Apple's licence means the files aren't in the repo: add your copies to `public/fonts` (see `public/fonts/README.md`).
- Background: `public/colorbends.js` runs the original ColorBends fragment shader on plain WebGL (no three.js), with the same props.
- Past Work and Projects page through their items (3, 2 or 1 per page depending on screen width) instead of scrolling.
