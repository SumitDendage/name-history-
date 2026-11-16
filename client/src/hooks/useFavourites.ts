import { useCallback, useEffect, useState } from 'react';
import type { Market, NamingType, Style } from '../../../shared/brief';
import { readJson, writeJson } from '../lib/storage';

export interface Favourite {
  name: string;
  reason: string;
  savedAt: string;
  context: { type: NamingType; market: Market; style: Style };
}

const KEY = 'nameforge.favourites.v1';
const keyOf = (name: string) => name.toLowerCase();

function load(): Favourite[] {
  const list = readJson<unknown>(KEY, []);
  return Array.isArray(list) ? (list.filter((f) => f && typeof f.name === 'string') as Favourite[]) : [];
}

/** Favourites are saved in this browser only (localStorage) and sync across open tabs. */
export function useFavourites() {
  const [favourites, setFavourites] = useState<Favourite[]>(load);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setFavourites(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((fn: (list: Favourite[]) => Favourite[]) => {
    setFavourites((prev) => {
      const next = fn(prev);
      writeJson(KEY, next);
      return next;
    });
  }, []);

  const isSaved = useCallback((name: string) => favourites.some((f) => keyOf(f.name) === keyOf(name)), [favourites]);

  const toggle = useCallback(
    (fav: Omit<Favourite, 'savedAt'>): boolean => {
      let saved = false;
      update((list) => {
        if (list.some((f) => keyOf(f.name) === keyOf(fav.name))) return list.filter((f) => keyOf(f.name) !== keyOf(fav.name));
        saved = true;
        return [{ ...fav, savedAt: new Date().toISOString() }, ...list];
      });
      return saved;
    },
    [update],
  );

  const remove = useCallback((name: string) => update((list) => list.filter((f) => keyOf(f.name) !== keyOf(name))), [update]);
  const clear = useCallback(() => update(() => []), [update]);

  return { favourites, isSaved, toggle, remove, clear };
}
