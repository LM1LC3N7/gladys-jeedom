import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseJeedomUrl } from '../src/config.js';

test('the API URL from what the user typed', () => {
  const url = (raw) => parseJeedomUrl(raw).url;
  assert.equal(url('192.168.1.20'), 'http://192.168.1.20/core/api/jeeApi.php');
  assert.equal(url(' https://jeedom.lan/ '), 'https://jeedom.lan/core/api/jeeApi.php');
  assert.equal(url('http://box:8080/jeedom/'), 'http://box:8080/jeedom/core/api/jeeApi.php');
  assert.equal(url('http://box/index.php?v=d&p=dashboard'), 'http://box/core/api/jeeApi.php');
  assert.equal(
    url('http://box/core/api/jeeApi.php'),
    'http://box/core/api/jeeApi.php',
    'the full API URL is kept',
  );
  assert.equal(parseJeedomUrl('http://box:8080').origin, 'http://box:8080');
});

test('the addresses refused', () => {
  assert.deepEqual(parseJeedomUrl(''), { error: 'empty' });
  assert.deepEqual(parseJeedomUrl(undefined), { error: 'empty' });
  assert.deepEqual(parseJeedomUrl('ftp://box'), { error: 'invalid' });
  assert.deepEqual(parseJeedomUrl('http://'), { error: 'invalid' });
  assert.deepEqual(parseJeedomUrl('http://admin:pw@box'), { error: 'credentials' });
});

test('the configuration, normalized', () => {
  assert.deepEqual(normalizeConfig(), {
    url: undefined,
    origin: undefined,
    error: 'empty',
    apiKey: '',
    verifyCertificate: true,
    pollInterval: 2,
    sensorInterval: 10,
  });
  const c = normalizeConfig({
    jeedom_url: 'jeedom.lan',
    api_key: ' key ',
    verify_certificate: false,
    poll_interval: 0,
    sensor_interval: 1000,
  });
  assert.deepEqual(
    [c.url, c.error, c.apiKey, c.verifyCertificate, c.pollInterval, c.sensorInterval],
    ['http://jeedom.lan/core/api/jeeApi.php', undefined, 'key', false, 1, 300],
  );
  assert.equal(normalizeConfig({ jeedom_url: 'jeedom.lan' }).error, 'no-key');
  assert.equal(
    normalizeConfig({ jeedom_url: 'jeedom.lan', api_key: 'k', poll_interval: 'x' }).pollInterval,
    2,
  );
  assert.equal(
    normalizeConfig({ jeedom_url: 'jeedom.lan', api_key: 'k', poll_interval: 1.5 }).pollInterval,
    1.5,
  );
});
