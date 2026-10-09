import { AppError } from '../lib/errors.js'
import { audit } from '../lib/audit.js'

/**
 * Every write event goes: validate (zod) → service (policy inside) → ack { ok, data } | { ok:false, code, meta }.
 * Denials are audited so bypass attempts leave a trail.
 */
export const on = (socket, event, schema, handler) =>
  socket.on(event, async (raw, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    const parsed = schema.safeParse(raw ?? {})
    if (!parsed.success) return reply({ ok: false, code: 'VALIDATION_FAILED', meta: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } })
    const user = socket.data.user
    try {
      reply({ ok: true, data: await handler(user, parsed.data, socket) })
    } catch (e) {
      const code = e instanceof AppError ? e.code : 'SERVER_ERROR'
      if (!(e instanceof AppError)) console.error(`[socket ${event}]`, e)
      else if (['NOT_MEMBER', 'BOARD_SCOPE', 'FORBIDDEN_DM', 'NOT_CR', 'TICKET_SCOPE', 'FORBIDDEN', 'DEPARTMENT_BOUNDARY', 'READ_ONLY_CHANNEL', 'ANNOUNCE_ONLY'].includes(code)) audit(user, `${event}:denied`, { category: 'security', meta: { code, event } })
      reply({ ok: false, code, meta: e.meta, message: e.meta?.message ?? e.meta?.reason })
    }
  })
