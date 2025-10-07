const MAPBOX_DEFAULT_STYLE_URL =
  'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token={apiKey}';
const MAPBOX_DEFAULT_TOKEN =
  'pk.eyJ1Ijoiam9hb2FydGh1cnNvdXphc2FudG9zIiwiYSI6ImNtY29xYWtmdTBpZzQycG9tZ2g0ZHk4NHAifQ.BF849wNk7PIUM1MI3c9ghg';
const MAPBOX_DEFAULT_NAME = 'Mapbox Satellite';
const MAPBOX_DEFAULT_USER_AGENT = 'AppReflorest/1.0 (mapbox)';

export const TILE_PROVIDER_URL_TEMPLATE =
  process.env.EXPO_PUBLIC_TILE_PROVIDER_URL?.trim() ?? MAPBOX_DEFAULT_STYLE_URL;
export const TILE_PROVIDER_API_KEY =
  process.env.EXPO_PUBLIC_TILE_PROVIDER_API_KEY?.trim() ?? MAPBOX_DEFAULT_TOKEN;
export const TILE_PROVIDER_NAME =
  process.env.EXPO_PUBLIC_TILE_PROVIDER_NAME?.trim() ?? MAPBOX_DEFAULT_NAME;
export const TILE_PROVIDER_USER_AGENT =
  process.env.EXPO_PUBLIC_TILE_PROVIDER_USER_AGENT?.trim() ?? MAPBOX_DEFAULT_USER_AGENT;

export const isTileProviderConfigured = () => TILE_PROVIDER_URL_TEMPLATE.length > 0;

const replacePlaceholders = (template: string, zoom: number, x: number, y: number) =>
  template
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

const appendApiKeyIfNeeded = (url: string) => {
  if (!TILE_PROVIDER_API_KEY) {
    return url;
  }

  if (url.includes('{apiKey}')) {
    return url.replace('{apiKey}', TILE_PROVIDER_API_KEY);
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}key=${encodeURIComponent(TILE_PROVIDER_API_KEY)}`;
};

export const buildTileUrl = (zoom: number, x: number, y: number): string | null => {
  if (!isTileProviderConfigured()) {
    return null;
  }

  const template = TILE_PROVIDER_URL_TEMPLATE;
  return appendApiKeyIfNeeded(replacePlaceholders(template, zoom, x, y));
};

export const getTileRequestHeaders = () => {
  const headers: Record<string, string> = {};
  if (TILE_PROVIDER_USER_AGENT) {
    headers['User-Agent'] = TILE_PROVIDER_USER_AGENT;
  }
  return headers;
};
