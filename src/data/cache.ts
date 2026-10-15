// Caché en IndexedDB: la ciudad ya convertida (para no volver a descargar) y las partidas guardadas.
import type { CityData } from './types.ts';

const DB_NAME = 'little-transit';
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cities')) db.createObjectStore('cities');
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export function cityKey(lat: number, lon: number, radius: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)},${Math.round(radius)}`;
}

export const cache = {
  getCity: (key: string) => tx<CityData | undefined>('cities', 'readonly', s => s.get(key)),
  putCity: (key: string, city: CityData) => tx('cities', 'readwrite', s => s.put(city, key)),
  deleteCity: (key: string) => tx('cities', 'readwrite', s => s.delete(key)),
  listCityKeys: () => tx<IDBValidKey[]>('cities', 'readonly', s => s.getAllKeys()),
  listCities: () => tx<CityData[]>('cities', 'readonly', s => s.getAll()),
  getSave: <T>(key: string) => tx<T | undefined>('saves', 'readonly', s => s.get(key)),
  putSave: (key: string, data: unknown) => tx('saves', 'readwrite', s => s.put(data, key)),
  deleteSave: (key: string) => tx('saves', 'readwrite', s => s.delete(key)),
};
