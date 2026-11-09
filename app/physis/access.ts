import { useEffect, useRef, useState } from 'react';
import { physisRequest } from '../cloud-sync';
import { createPhysisAccessCheck, type PhysisAccessStatus } from './access-check';
export function usePhysisAccess(userId: string) {
  const [result, setResult] = useState<{ owner: string; status: PhysisAccessStatus }>({ owner: '', status: 'checking' });
  const check = useRef<ReturnType<typeof createPhysisAccessCheck> | null>(null);
  useEffect(() => {
    if (!userId) return;
    const current = createPhysisAccessCheck(userId, signal => physisRequest('/access', { signal }),
      status => setResult({ owner: userId, status }));
    check.current = current;
    const refresh = () => { if (document.visibilityState !== 'hidden') void current.refresh(); };
    void current.refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      current.stop(); check.current = null;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId]);
  const status = userId && result.owner === userId ? result.status : 'checking';
  return { available: status === 'ready', showEntry: status === 'ready', status,
    retry: () => { void check.current?.refresh(); } };
}
