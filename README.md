# brzy-portfolio

Portfolio site with a notch navbar, a WebGL ColorBends hero, and a Discord-gated admin panel. Tailwind (CDN) and vanilla JS on the front end, a small Express server on the back end. No React.

## Run it

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in:
   - Create an app at https://discord.com/developers/applications
   - Under OAuth2, add the redirect `<BASE_URL>/auth/callback` (locally: `http://localhost:3000/auth/callback`)
   - Put the client ID and secret in `.env`
   - Set `ADMIN_IDS` to your Discord user ID (comma-separate more than one)
   - Set `SESSION_SECRET` to a long random string
3. `npm start` and open http://localhost:3000

## Admin panel

Sign in with Discord. If your user ID is in `ADMIN_IDS`, an **Admin** button appears in the notch. Other users, and signed-out visitors, never receive the panel's markup or script: the server returns 403 for them, and every `/api/admin/*` route checks the signed session.

Tabs: Past Work, Projects, Contacts, Clients. For Clients, paste a Discord invite; the server fetches the server name, icon and member count. Use Refresh to update the count.

## Notes

- Content is stored in `data/db.json` (created from `data/seed.json` on first run, git-ignored). On hosts with ephemeral disks, point it at a persistent volume.
- Font: SF Pro only, loaded from the visitor's device (SF Pro is licensed for Apple platforms and can't be redistributed in a repo).
- Hero background: `public/colorbends.js` is a vanilla WebGL port of ColorBends with the same props.
