import 'dotenv/config'

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/cui_connect',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret',
  clientUrl: (process.env.CLIENT_URL ?? 'http://localhost:5173').split(','),
  redisUrl: process.env.REDIS_URL,
  tlsKey: process.env.TLS_KEY,
  tlsCert: process.env.TLS_CERT,
  httpRedirectPort: Number(process.env.HTTP_REDIRECT_PORT ?? 0),
  isProd: process.env.NODE_ENV === 'production',
  accessTtl: '15m',
  refreshDays: 14,
}
