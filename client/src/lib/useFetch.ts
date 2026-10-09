import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'

export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(!!path)
  const load = useCallback(async () => {
    if (!path) return
    setLoading(true)
    try { setData(await api.get<T>(path)); setError(null) } catch (e) { setError(e as ApiError) } finally { setLoading(false) }
  }, [path])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load, ...deps])
  return { data, error, loading, reload: load, setData }
}
