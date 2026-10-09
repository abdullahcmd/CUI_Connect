import { ZodError } from 'zod'
import { AppError, SENTENCES, httpStatus } from './errors.js'

export function parse(schema, data) {
  const r = schema.safeParse(data)
  if (!r.success) throw new AppError('VALIDATION_FAILED', 422, { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
  return r.data
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) err = new AppError('VALIDATION_FAILED', 422, { issues: err.issues })
  if (err.name === 'MulterError') err = new AppError('VALIDATION_FAILED', 422, { reason: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB.' : err.message })
  if (err.name === 'CastError') err = new AppError('NOT_FOUND', 404)
  const code = err.code && typeof err.code === 'string' && !/^E[A-Z]+$/.test(err.code) ? err.code : 'SERVER_ERROR'
  const status = err instanceof AppError ? err.status ?? httpStatus(code) : code === 'SERVER_ERROR' ? 500 : httpStatus(code)
  if (status >= 500) console.error(err)
  res.status(status).json({ ok: false, code, message: err.meta?.message ?? err.meta?.reason ?? SENTENCES[code] ?? err.message, meta: err.meta })
}
