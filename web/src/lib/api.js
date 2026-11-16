import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: url => request('DELETE', url),
  /** Upload a file as the raw request body; the file name goes in ?name= */
  upload: async (url, file) => {
    const res = await fetch(`/api${url}?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': file.type || 'application/pdf' }, body: file });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || res.statusText);
    return data;
  },
};

// Query keys are the URL itself, so a server change event can simply invalidate everything.
export const useApi = (url, opts) => useQuery({ queryKey: [url], queryFn: () => api.get(url), enabled: !!url, ...opts });

export function useMutate(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}
