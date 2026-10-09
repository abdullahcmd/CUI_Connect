# CUI Connect

Role-bounded communication platform for COMSATS University Islamabad: Slack-style groups with real-time chat (Socket.IO), CR relay, Announcement Board, student channels, help desks, exam cell, and an admin console.

```
client/   React 18 + Vite  (design system from design.md; Scholarships screen built, rest in progress)
server/   Node 20 + Express + Socket.IO + MongoDB (Mongoose)
```

## Security: encryption

- **In transit:** the API, Socket.IO and the dev client all run over HTTPS/WSS using a self-signed development certificate (`cd server && npm run cert`, already generated). Your browser asks you to accept it once. In production, `docker compose up` puts nginx in front with your real certificate (`deploy/certs`), HSTS and HTTP→HTTPS redirect.
- **At rest:** message text, ticket text, report evidence and uploaded files are encrypted with AES-256-GCM before they reach MongoDB or disk. The key is `MESSAGE_KEY` in `server/.env` (make one with `npm run keygen`). **Back it up and keep it out of git: without it stored messages cannot be read.**

## Run it locally

```bash
# 1. MongoDB (already installed via Homebrew). Keeps data inside the project:
cd server && npm run db            # leave running in its own terminal
# 2. demo data (wipes the DB and refills it, ~10 s)
npm run seed
# 3. API + sockets on http://localhost:4000
npm start                          # or: npm run dev   (auto-restart)
# 4. verify everything (119 checks: REST, live sockets, bypass attempts)
npm run smoke
# 5. client on https://localhost:5173
cd ../client && npm run dev
```

Demo logins are listed in [server/DEMO_ACCOUNTS.md](server/DEMO_ACCOUNTS.md).
Redis is optional: set `REDIS_URL` in `server/.env` to switch on the Socket.IO redis adapter. `docker compose up --build` runs api + mongo + redis.

See [server/README.md](server/README.md) for the architecture, socket events and REST map.
