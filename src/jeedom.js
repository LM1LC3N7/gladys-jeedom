// -----------------------------------------------------------------------------
// The Jeedom JSON-RPC API (core/api/jeeApi.php): the only network access.
//
// One POST per call, body { jsonrpc: '2.0', id, method, params } with the API
// key in params.apikey. Jeedom answers HTTP 200 with { result } or
// { error: { code, message } }, an HTML page when the address is not a Jeedom
// API (or when Jeedom banned the caller after failed logins).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

export class JeedomError extends Error {
  /**
   * @param {'auth'|'forbidden'|'api'|'network'|'certificate'|'timeout'|'http'|'redirect'|'format'|'size'} kind
   */
  constructor(kind, message, { code, status } = {}) {
    super(message);
    this.name = 'JeedomError';
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** A socket error -> JeedomError (never the request body: it holds the key). */
export function networkError(err) {
  if (err instanceof JeedomError) {
    return err;
  }
  if (CERTIFICATE_CODES.has(err?.code)) {
    return new JeedomError('certificate', `certificate refused (${err.code})`);
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? err?.message ?? 'network error';
  return new JeedomError('network', reason);
}

/**
 * POSTs a body and resolves { status, location, body }.
 * @param {string} url
 * @param {string} body
 * @param {{ timeout: number, verifyCertificate: boolean, agent?: http.Agent, maxBytes?: number }} options
 */
export function httpPost(url, body, { timeout, verifyCertificate, agent, maxBytes }) {
  const limit = maxBytes ?? LIMITS.responseBytes;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    /** The first outcome wins: a destroyed request may still end or fail after it. */
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(
      target,
      {
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json',
        },
        rejectUnauthorized: verifyCertificate,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) {
            const mb = Math.max(1, Math.round(limit / 1048576));
            settle(reject, new JeedomError('size', `answer larger than ${mb} MB`));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          settle(resolve, {
            status: res.statusCode,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', (err) => settle(reject, networkError(err)));
      },
    );
    timer = setTimeout(() => {
      settle(
        reject,
        new JeedomError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

/** The result of a JSON-RPC answer, or the JeedomError it carries. */
export function parseAnswer({ status, location, body }) {
  if (status >= 300 && status < 400) {
    let where = location ?? '';
    try {
      where = new URL(location).origin;
    } catch {
      // A relative location: keep it as is.
    }
    return Promise.reject(new JeedomError('redirect', `redirected to ${where}`, { status }));
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  if (!json || typeof json !== 'object') {
    return Promise.reject(
      status === 200
        ? new JeedomError('format', 'not a Jeedom API answer', { status })
        : new JeedomError('http', `HTTP ${status}`, { status }),
    );
  }
  if (json.error) {
    const code = Number(json.error.code);
    const message = String(json.error.message ?? 'unknown error').slice(0, 300);
    // jeeApi.php answers -32000 minus the code of its exception: a refused
    // key (-32002) becomes 2, a refused access (-32001) becomes 1.
    let kind = 'api';
    if (code === 2) {
      kind = 'auth';
    } else if (code === 1 || /autoris|authori/i.test(message)) {
      kind = 'forbidden';
    }
    return Promise.reject(new JeedomError(kind, message, { code }));
  }
  if (!('result' in json)) {
    return Promise.reject(new JeedomError('format', 'not a Jeedom API answer', { status }));
  }
  return Promise.resolve(json.result);
}

/**
 * Jeedom answers "ok" instead of an empty list, and a PHP array with holes as
 * an object: always a list.
 */
export const asList = (result) => {
  if (Array.isArray(result)) {
    return result;
  }
  return result && typeof result === 'object' ? Object.values(result) : [];
};

/**
 * A JSON-RPC client of one Jeedom box.
 * @param {{ url: string, apiKey: string, verifyCertificate: boolean, post?: typeof httpPost }} options
 */
export function createClient({ url, apiKey, verifyCertificate, post = httpPost }) {
  const agent = new (url.startsWith('https:') ? https : http).Agent({
    keepAlive: true,
    maxSockets: 2,
  });
  let id = 0;
  return {
    async call(method, params = {}, { timeout = TIMINGS.requestTimeout } = {}) {
      id += 1;
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: { ...params, apikey: apiKey },
      });
      return parseAnswer(await post(url, body, { timeout, verifyCertificate, agent }));
    },
    close() {
      agent.destroy();
    },
  };
}
