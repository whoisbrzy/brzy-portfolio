# brzy-portfolio

Portfolio with a notch navbar, a ColorBends WebGL background, separate click-through pages (Home, Past Work, Projects, Contact; nothing scrolls) and a Discord-gated admin panel. Tailwind (CDN) and vanilla JS on the front end, a small Express app on the back end. No React.

## Deploy on Vercel

1. Import the repo into Vercel.
2. Storage tab: add **Upstash Redis** and connect it to the project. This sets the `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` variables.
3. Environment Variables:

   | Name | Value |
   |---|---|
   | `DISCORD_CLIENT_ID` | from the Discord developer portal |
   | `DISCORD_CLIENT_SECRET` | from the Discord developer portal |
   | `ADMIN_IDS` | your Discord user ID (comma-separate more than one) |
   | `SESSION_SECRET` | a long random string |

4. Discord developer portal, OAuth2 -> Redirects: add `https://brzyx.vercel.app/auth/discord`. The only scope used is `identify`. The redirect address is built from the site the visitor is on, so it must be registered for exactly the domain you use (no trailing slash).
5. Redeploy, then open `https://brzyx.vercel.app/api/content`. You should see JSON. If you see a 404, the server isn't running (check that the project has no custom Output Directory or Framework override that conflicts with `vercel.json`).

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env`, fill it in, and add `http://localhost:3000/auth/discord` as a second Discord redirect.
3. `npm start`, then open http://localhost:3000. Without Redis variables, edits are saved to `data/db.json`.

## Admin panel

Sign in with Discord. If your user ID is in `ADMIN_IDS`, an **Admin** button appears in the notch. Other users, and signed-out visitors, never receive the panel's markup or script: the server returns 403 for them, and every `/api/admin/*` route checks the signed session.

Tabs: Past Work, Projects, Contacts, Clients. For Clients, paste a Discord invite; the server fetches the server name, icon and member count. Use Refresh to update the count. Clients show at the bottom of the home page.

## Tools page

`#/tools` is for signed-in Discord users (any account, not just admins). The tools' code is only served by `/tools/tools.js` and `/tools/tools.html` to a valid session, so signed-out visitors get a 401, not just a hidden button. Everything runs in the browser, so images are never uploaded.

- **Background Remover:** automatic AI mode (loads `@imgly/background-removal` from jsDelivr on first use) with a solid-color fallback.
- **Font Finder:** previews about 50 Google Fonts with your own text. It cannot identify a font from an image.
- **Color Picker:** magnifier, HEX/RGB/HSL, dominant palette.
- **Split Images:** grid presets, PNG or JPG, per-tile or zip download.
- **Icons:** search and download from Iconify's open icon sets.
- **Roblox Clothing Showcaser:** rotating character wearing the classic 585 x 559 shirt and pants templates. Exports carry the site favicon, which is fetched through `/favicon-image` so the canvas can export it.

## Notes

- Fonts: SF Pro and SF Compact only. Apple's licence means the files aren't in the repo: add your copies to `public/fonts` (see `public/fonts/README.md`).
- Background: `public/colorbends.js` runs the original ColorBends fragment shader on plain WebGL (no three.js), with the same props.
- Past Work and Projects page through their items (3, 2 or 1 per page depending on screen width) instead of scrolling.
