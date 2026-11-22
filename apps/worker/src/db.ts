export interface InsertOpts { onConflict?: string; ignoreDuplicates?: boolean }
export interface Db {
  select<T>(table: string, query: string): Promise<T[]>;
  insert(table: string, rows: unknown, opts?: InsertOpts): Promise<boolean>;
  update(table: string, query: string, patch: unknown): Promise<boolean>;
}

export function makeDb(url: string, key: string): Db {
  const base = url.replace(/\/+$/, '');
  const headers = (extra: Record<string, string> = {}): Record<string, string> => {
    const h: Record<string, string> = { apikey: key, 'content-type': 'application/json', ...extra };
    if (!key.startsWith('sb_')) h.authorization = `Bearer ${key}`;
    return h;
  };
  const fail = async (what: string, res: Response): Promise<false> => {
    console.log(`supabase ${what} failed`, res.status, (await res.text()).slice(0, 300));
    return false;
  };
  return {
    async select<T>(table: string, query: string): Promise<T[]> {
      const res = await fetch(`${base}/rest/v1/${table}?${query}`, { headers: headers() });
      if (!res.ok) { await fail(`select ${table}`, res); return []; }
      try { return (await res.json()) as T[]; } catch { return []; }
    },
    async insert(table: string, rows: unknown, opts: InsertOpts = {}): Promise<boolean> {
      const q = opts.onConflict ? `?on_conflict=${opts.onConflict}` : '';
      const prefer = opts.onConflict ? `resolution=${opts.ignoreDuplicates ? 'ignore' : 'merge'}-duplicates,return=minimal` : 'return=minimal';
      const res = await fetch(`${base}/rest/v1/${table}${q}`, { method: 'POST', headers: headers({ prefer }), body: JSON.stringify(rows) });
      return res.ok ? true : fail(`insert ${table}`, res);
    },
    async update(table: string, query: string, patch: unknown): Promise<boolean> {
      const res = await fetch(`${base}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: headers({ prefer: 'return=minimal' }), body: JSON.stringify(patch) });
      return res.ok ? true : fail(`update ${table}`, res);
    },
  };
}
