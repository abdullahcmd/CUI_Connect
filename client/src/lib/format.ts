const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
export const fmtTime = (d: string | Date) => new Date(d).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase().replace(/^(\d):/, '$1:')
export function fmtStamp(d: string | Date) {
  const x = new Date(d)
  if (sameDay(x, new Date())) return fmtTime(x)
  return `${x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmtTime(x)}`
}
export function fmtDay(d: string | Date) {
  const x = new Date(d), now = new Date()
  if (sameDay(x, now)) return 'Today'
  if (sameDay(x, new Date(now.getTime() - 86400_000))) return 'Yesterday'
  return x.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}
export const isUrdu = (s: string) => /[؀-ۿ]/.test(s)
export const fmtSize = (n?: number) => (n == null ? '' : n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)
export const ago = (d: string | Date) => { const m = Math.round((Date.now() - +new Date(d)) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d` }
