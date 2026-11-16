import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// One SSE connection; every DB change (UI, Claude, scripts) refreshes the visible queries.
export function useLiveUpdates() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let timer;
    const es = new EventSource('/api/events');
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.addEventListener('hello', () => setOnline(true));
    es.addEventListener('change', () => {
      setOnline(true);
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries(), 150);
    });
    return () => { clearTimeout(timer); es.close(); };
  }, [qc]);
  return online;
}
