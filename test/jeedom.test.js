// The JSON-RPC client, with a fake transport: no network in the tests (the
// real HTTP path is checked against a Jeedom box, see TODO.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JeedomError, asList, createClient, networkError, parseAnswer } from '../src/jeedom.js';

const ok = (body, status = 200) => ({ status, body: JSON.stringify(body) });

const rejection = async (answer) => {
  try {
    await parseAnswer(answer);
  } catch (err) {
    assert.ok(err instanceof JeedomError);
    return { kind: err.kind, message: err.message };
  }
  assert.fail('resolved');
};

test('a result, or the error Jeedom answered', async () => {
  assert.equal(await parseAnswer(ok({ jsonrpc: '2.0', id: 1, result: 'pong' })), 'pong');
  assert.deepEqual(
    await rejection(
      ok({ jsonrpc: '2.0', id: 1, error: { code: 2, message: "Vous n'êtes pas autorisé" } }),
    ),
    { kind: 'auth', message: "Vous n'êtes pas autorisé" },
  );
  assert.equal(
    (await rejection(ok({ error: { code: 1, message: 'Accès refusé' } }))).kind,
    'forbidden',
  );
  assert.deepEqual(await rejection(ok({ error: { code: 702, message: 'Commande introuvable' } })), {
    kind: 'api',
    message: 'Commande introuvable',
  });
});

test('what is not a Jeedom API answer', async () => {
  assert.deepEqual(await rejection({ status: 200, body: '<html>Jeedom</html>' }), {
    kind: 'format',
    message: 'not a Jeedom API answer',
  });
  assert.deepEqual(await rejection({ status: 404, body: '<h1>404 Not Found</h1>' }), {
    kind: 'http',
    message: 'HTTP 404',
  });
  assert.deepEqual(
    await rejection({ status: 302, location: 'https://jeedom.lan/core/api/jeeApi.php', body: '' }),
    { kind: 'redirect', message: 'redirected to https://jeedom.lan' },
  );
  assert.equal((await rejection(ok({ jsonrpc: '2.0' }))).kind, 'format');
});

test('the requests: JSON-RPC 2.0, the key in the params', async () => {
  const sent = [];
  const client = createClient({
    url: 'http://192.168.1.20/core/api/jeeApi.php',
    apiKey: 'secret-key',
    verifyCertificate: false,
    post: async (url, body, options) => {
      sent.push({ url, body: JSON.parse(body), options });
      return ok({ jsonrpc: '2.0', id: sent.length, result: ['x'] });
    },
  });
  assert.deepEqual(await client.call('cmd::execCmd', { id: '12', options: { slider: 5 } }), ['x']);
  await client.call('version', {}, { timeout: 1234 });
  client.close();
  assert.equal(sent[0].url, 'http://192.168.1.20/core/api/jeeApi.php');
  assert.deepEqual(sent[0].body, {
    jsonrpc: '2.0',
    id: 1,
    method: 'cmd::execCmd',
    params: { id: '12', options: { slider: 5 }, apikey: 'secret-key' },
  });
  assert.equal(sent[0].options.verifyCertificate, false);
  assert.equal(sent[0].options.timeout, 15_000);
  assert.equal(sent[1].body.id, 2);
  assert.equal(sent[1].options.timeout, 1234);
});

test('network errors, without the request', () => {
  const refused = networkError(
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  );
  assert.deepEqual([refused.kind, refused.message], ['network', 'connection refused']);
  const cert = networkError(
    Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
  );
  assert.deepEqual(
    [cert.kind, cert.message],
    ['certificate', 'certificate refused (DEPTH_ZERO_SELF_SIGNED_CERT)'],
  );
  const timeout = new JeedomError('timeout', 'no answer within 15 s');
  assert.equal(networkError(timeout), timeout);
});

test('lists', () => {
  assert.deepEqual(asList('ok'), []);
  assert.deepEqual(asList([1]), [1]);
  assert.deepEqual(asList({ 3: 'a', 7: 'b' }), ['a', 'b']);
  assert.deepEqual(asList(null), []);
});
