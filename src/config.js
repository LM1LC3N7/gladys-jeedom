// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { API_PATH, POLL_INTERVAL, SENSOR_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  jeedom_url: '',
  api_key: '',
  verify_certificate: true,
  poll_interval: POLL_INTERVAL.default,
  sensor_interval: SENSOR_INTERVAL.default,
};

/**
 * The URL of the JSON-RPC API from what the user typed: "192.168.1.20",
 * "http://jeedom.lan/", "https://box/jeedom" or the full API URL.
 * @returns {{ url: string, origin: string } | { error: 'empty' | 'invalid' | 'credentials' }}
 */
export function parseJeedomUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // The API key is the credential, in its own (secret) field.
    return { error: 'credentials' };
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith(API_PATH)) {
    path = `${path.replace(/\/index\.php$/, '')}${API_PATH}`;
  }
  return { url: `${url.origin}${path}`, origin: url.origin };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const target = parseJeedomUrl(c.jeedom_url);
  const apiKey = String(c.api_key ?? '').trim();
  return {
    url: target.url,
    origin: target.origin,
    error: target.error ?? (apiKey === '' ? 'no-key' : undefined),
    apiKey,
    verifyCertificate: c.verify_certificate !== false,
    pollInterval: bounded(c.poll_interval, POLL_INTERVAL),
    sensorInterval: Math.round(bounded(c.sensor_interval, SENSOR_INTERVAL)),
  };
}
