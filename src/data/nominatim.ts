// Búsqueda de ciudades con Nominatim (OpenStreetMap). Sin clave; una consulta por segundo como máximo.

export interface Place {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  type: string;
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export async function searchPlaces(query: string, lang = 'es', signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${ENDPOINT}?format=jsonv2&limit=6&addressdetails=1&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const rows = (await r.json()) as Array<{
    display_name: string; lat: string; lon: string; type: string; name?: string;
    address?: Record<string, string>;
  }>;
  return rows.map(row => {
    const a = row.address ?? {};
    const name = row.name || a.city || a.town || a.village || a.municipality || row.display_name.split(',')[0];
    return { name, displayName: row.display_name, lat: parseFloat(row.lat), lon: parseFloat(row.lon), type: row.type };
  });
}
