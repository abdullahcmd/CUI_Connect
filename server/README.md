# CUI Connect — server

Node 20 · Express · Socket.IO v4 · MongoDB 7 (Mongoose) · Zod · JWT (15 min access + rotating refresh) · bcrypt.

```
src/
  config/     env, db
  models/     Mongoose models (org, messaging, board, desk, misc)
  policy/     the access-control engine: roles.js (rank, holds), index.js (canRead/canPost/canPublish/canRelay/assertCanAssign), dmRules.js (DM table)
  services/   all business logic; routes and sockets only call these
  routes/     REST (auth, me, groups, board, channels, desks, exam, dept, admin, misc)
  sockets/    handshake auth, guard (validate → policy → ack), rooms, handlers
  seed/       seed.js (demo data via the real services), smoke.js (119 end-to-end checks), createSuperadmin.js
```

## Boundaries live in one place

`policy/` is pure functions `(actor, target) → { allow, code, meta }`. Socket handlers and REST routes never decide on their own. Enforcement points: JWT on the socket handshake, server-side room joins (`group:open` is only a request), every write event goes through `sockets/guard.js`, REST uses the same services, and fan-out goes only to the room of the group a message was posted in (a CR relay creates a *new* message in the class group; it never exposes the CR line).

Teachers never see class groups; they reach a class through the CR line. HOD/coordinators see every class in their department through *visibility grants*, not memberships. Role changes, CR assignment and term rollover call `resync()`, which recomputes memberships and moves live sockets in and out of rooms without reconnecting.

## Socket events (ack: `{ ok, data }` or `{ ok:false, code, meta }`)

Client → server: `group:open` `message:send` `message:relay` `message:edit` `message:delete` `message:read` `message:react` `message:pin` `typing` `group:announceOnly` `dm:open` `board:publish` `board:acknowledge` `board:forward` `ticket:create|open|reply|escalate|resolve|assign|reopen` `channel:publish|follow|interest|save` `presence:who`

Server → client: `message:new|updated|deleted|reactions|thread` `relay:status` `group:changed` `group:read` `membership:changed` `typing` `presence` `board:new|updated|deleted|ack` `ticket:created|updated|message` `channel:post|counts` `notification` `account:suspended` `settings:changed` · namespace `/admin`: `admin:counters`, `audit:new`

Error codes: UNAUTHENTICATED NOT_MEMBER READ_ONLY_CHANNEL ANNOUNCE_ONLY FORBIDDEN_DM TEACHER_NOT_ASSIGNED DEPARTMENT_BOUNDARY NOT_CR BOARD_SCOPE TICKET_SCOPE INCOMPLETE_HIERARCHY RATE_LIMITED VALIDATION_FAILED RANK_VIOLATION SELF_ASSIGNMENT FORBIDDEN NOT_FOUND CONFLICT ACCOUNT_LOCKED ACCOUNT_SUSPENDED. Every error response also carries a ready-to-show `message`.

## REST map (all under `/api`, bearer token except auth/health/status/dev)

| Area | Endpoints |
| --- | --- |
| Auth (AUTH-01…06) | `POST /auth/login refresh logout activate change-password forgot verify reset` · `GET /auth/sessions` · `DELETE /auth/sessions/:id` · `GET /status` (maintenance) · `GET /dev/mailbox` (dev only: emailed codes) |
| Me / settings (APP) | `GET /me` (profile, roles, capabilities, sidebar, landing) · `PATCH /me/settings` · `GET /notifications` · saved items · blocks · `GET /people?q=` (with DM allowed/route) · `GET /search?q=&scope=` |
| Groups / messages (MSG) | `GET /groups` `GET /groups/:id` (details panel + composer state) `…/messages?before=&threadOf=` `…/members` `…/pins` `…/files` `…/relay-status` · `PATCH /groups/:id/settings` · `POST /groups` (custom) `PUT /groups/:id/members` · `POST /dm/open` · message edit/delete/react/pin/relay/report |
| Board (BRD) | `GET /board` `/board/archive` `/board/scopes` `/board/telemetry` · `POST /board` · `GET/PATCH/DELETE /board/:id` · `…/ack` `…/acks` `…/acks.csv` `…/versions` `…/forward` `…/nudge` `…/remind` |
| Channels (CHN) | `GET /channels` `/channels/feed` `/channels/:slug` `/channels/moderation` `/channels/submissions` · follow/mute · `POST /channels/:id/posts` · interest/save/approve/reject |
| Desks (DSK) | `GET /desks` `/desks/:slug` `/desks/:slug/queue` `/desks/:slug/reports` · `POST /tickets` · `GET /tickets/mine` `/tickets/:id` · reply/assign/escalate/resolve/reopen |
| Exam cell | `GET /exam/console` · `POST /exam/circulars` · breakdown · remind · keypad validate |
| Department (DEP) | `/dept/mine` `/dept/:id/dashboard` `batches` `offerings` `teachers` `oversight` `students` · `POST /dept/batches` · `PUT /dept/batches/:id/crs` · `POST /terms/:code/offerings` (+ CSV import) |
| Admin (ADM) | dashboard · admins · departments (wizard) · users (+CSV import preview/commit/errors) · roles · terms + rollover preview/execute · offices · groups directory (no message content) · channels · board scopes · reports (`/reports`) · audit · system settings |
| Uploads | `POST /uploads` (PDF/PNG/JPG ≤ 10 MB, type decided by magic bytes) · `GET /files/:id` |

## Background jobs (every 60 s)
Board expiry · ticket overdue marking (office head notified, never auto-escalates) · resolved → closed after 72 h · 48 h apply-by reminders and cycle closing · alumni deactivation after 6 months · purge of removed messages after 30 days.
