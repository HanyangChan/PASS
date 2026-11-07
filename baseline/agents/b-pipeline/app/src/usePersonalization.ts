import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPersonalizationRepository, emptyPersonalization, type Personalization } from './services/personalization';

export function usePersonalization(owner: string | null) {
  const repository = useMemo(() => createPersonalizationRepository(AsyncStorage, owner), [owner]);
  const [data, setData] = useState(emptyPersonalization);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const flight = useRef(false);
  useEffect(() => {
    active.current = true;
    let mounted = true;
    repository.load().then(value => { if (mounted) { setData(value); setReady(true); setError(''); } })
      .catch(() => { if (mounted) setError('개인화 기록을 불러오지 못했어요. 다시 시도해주세요.'); });
    return () => { mounted = false; active.current = false; };
  }, [repository, attempt]);
  async function update(change: (old: Personalization) => Personalization) {
    if (!ready || flight.current) return;
    flight.current = true; setBusy(true); setError('');
    try {
      const next = change(data);
      await repository.save(next);
      if (active.current) setData(next);
    } catch (failure) {
      if (active.current) setError((failure as Error).message || '개인화 기록을 저장하지 못했어요. 다시 시도해주세요.');
    } finally { flight.current = false; if (active.current) setBusy(false); }
  }
  return { data, ready, busy, error, update, retry: () => { setReady(false); setError(''); setAttempt(n => n + 1); } };
}
