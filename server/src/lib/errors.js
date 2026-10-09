export class AppError extends Error {
  constructor(code, status = 400, meta = {}, message) {
    super(message ?? code)
    this.code = code
    this.status = status
    this.meta = meta
  }
}

export const HTTP_FOR = {
  UNAUTHENTICATED: 401, NOT_MEMBER: 403, READ_ONLY_CHANNEL: 403, ANNOUNCE_ONLY: 403, FORBIDDEN_DM: 403,
  TEACHER_NOT_ASSIGNED: 403, DEPARTMENT_BOUNDARY: 403, NOT_CR: 403, BOARD_SCOPE: 403, TICKET_SCOPE: 403,
  FORBIDDEN: 403, RANK_VIOLATION: 403, SELF_ASSIGNMENT: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422,
  INCOMPLETE_HIERARCHY: 422, RATE_LIMITED: 429, ACCOUNT_LOCKED: 423, ACCOUNT_SUSPENDED: 403, CONFLICT: 409,
}

export const httpStatus = (code) => HTTP_FOR[code] ?? 400

/** Human sentences the client can show verbatim (design.md: "every refusal says who can and where to go"). */
export const SENTENCES = {
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  NOT_MEMBER: "You don't have access to this group. Ask the group manager or your coordinator.",
  READ_ONLY_CHANNEL: 'This channel is read-only for you.',
  ANNOUNCE_ONLY: 'Only the group manager posts here right now.',
  FORBIDDEN_DM: 'Direct messages are not allowed with this person. Use the route suggested below.',
  TEACHER_NOT_ASSIGNED: "You aren't assigned to this batch this term.",
  DEPARTMENT_BOUNDARY: 'This action is limited to your own department.',
  NOT_CR: 'Only the Class Representative of this batch can relay messages to the class.',
  BOARD_SCOPE: "You can't publish to this scope.",
  TICKET_SCOPE: "This ticket isn't in your desk.",
  INCOMPLETE_HIERARCHY: 'A department needs a HOD, a Program Incharge for every program and at least one coordinator.',
  RATE_LIMITED: 'Slow down — too many requests. Try again in a moment.',
  VALIDATION_FAILED: 'Some fields are missing or invalid.',
  RANK_VIOLATION: "You can't assign a role equal to or above your own.",
  SELF_ASSIGNMENT: "You can't change your own role.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: 'Not found.',
}
