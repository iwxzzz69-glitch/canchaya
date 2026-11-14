'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/** Carga datos al montar o cuando cambian las dependencias. `null` como función = no cargar todavía. */
export function useQuery<T>(load: (() => Promise<T>) | null, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(Boolean(load));
  const seq = useRef(0);

  const run = useCallback(() => {
    if (!load) return;
    const mine = ++seq.current;
    setLoading(true);
    load()
      .then((d) => mine === seq.current && (setData(d), setError(undefined)))
      .catch((e) => mine === seq.current && setError(e instanceof ApiError ? e : new ApiError(0, 'Algo salió mal.')))
      .finally(() => mine === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(run, [run]);
  return { data, error, loading, reload: run, setData };
}
