// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake Jeedom box. Timers are mocked: the change loop, the
// reconnections and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { JeedomApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { T } from '../src/i18n.js';
import { JeedomError } from '../src/jeedom.js';
import { API_KEY, fakeJeedom, settle } from './helpers/fakeJeedom.js';

const DEVICE = (eqId) => `ext:test-integration:jeedom:${eqId}`;
const PLUG = DEVICE(12);
const POLL = 2000;

async function setup(t, config = { jeedom_url: '192.168.1.20', api_key: API_KEY }) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config });
  const box = fakeJeedom();
  const app = new JeedomApp({
    gladys,
    connect: box.connect,
    now: () => Date.now(),
    logger: createLogger({ level: 'silent' }),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, box, tick };
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

async function created(gladys, name) {
  const device = deviceNamed(gladys, name);
  assert.ok(device, `${name} is discovered`);
  await gladys.fake.deviceCreated(device);
  return device;
}

const featureOf = (device, key) => {
  const feature = device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
  assert.ok(feature, `${device.name} has ${key}`);
  return feature;
};

test('the inventory becomes Gladys devices, the values flow once a device is created', async (t) => {
  const { gladys, box, tick } = await setup(t);
  assert.equal(box.clients[0].config.url, 'http://192.168.1.20/core/api/jeeApi.php');
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name).sort(),
    [
      'Ampoule couleur (Salon)',
      'Capteur (Salon)',
      'Détecteur fumée (Cuisine)',
      'Lampe (Salon)',
      'Mode maison',
      'Portail (Garage)',
      "Porte d'entrée",
      'Prise TV (Salon)',
      'Serrure (Garage)',
      'Thermostat (Cuisine)',
      'Virtuel (Cuisine)',
      'Volet (Salon)',
    ],
    'disabled, hidden and empty equipment are left out',
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.connectionStatus.message.en, T.connected('4.4.19', 12).en);

  const plug = deviceNamed(gladys, 'Prise TV (Salon)');
  assert.equal(plug.external_id, PLUG);
  assert.deepEqual(plug.params, [
    { name: 'JEEDOM_ID', value: '12' },
    { name: 'JEEDOM_OBJECT', value: 'Salon' },
    { name: 'JEEDOM_PLUGIN', value: 'zwavejs' },
  ]);

  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  await gladys.fake.deviceCreated(plug);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${PLUG}:121-binary`), 1);
  assert.equal(gladys.fake.lastState(`${PLUG}:124-sensor`), 85.3);
  assert.equal(gladys.fake.lastState(`${PLUG}:125-sensor`), 12.5);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: PLUG,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('the changes of Jeedom reach Gladys at the poll interval, once', async (t) => {
  const { gladys, app, box, tick } = await setup(t);
  await created(gladys, 'Prise TV (Salon)');
  await created(gladys, "Porte d'entrée");
  box.emit('121', '0');
  box.emit('141', '0');
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${PLUG}:121-binary`), 0);
  assert.equal(gladys.fake.lastState(`${DEVICE(14)}:141-sensor`), 1, 'closed door');

  const [poll] = box.callsOf('event::changes').slice(-1);
  assert.ok(poll.params.datetime < box.clock - 0.5, 'the next query overlaps the previous one');
  const setRaw = t.mock.method(app, 'setRaw');
  await tick(POLL);
  assert.equal(setRaw.mock.calls.length, 0, 'the overlapping events are not applied twice');
  assert.equal(box.callsOf('cmd::all').length, 1, 'no inventory read for value changes');
});

test('the Gladys commands run the Jeedom actions', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const run = async (name, key, value) => {
    const device = deviceNamed(gladys, name);
    const before = box.executed.length;
    const ack = await gladys.fake.setValue(device, featureOf(device, key), value);
    assert.equal(ack.success, true, `${name} ${key}=${value}: ${ack.error}`);
    return box.executed.slice(before);
  };
  assert.deepEqual(await run('Lampe (Salon)', '101-binary', 1), [{ id: '102', options: {} }]);
  assert.deepEqual(await run('Lampe (Salon)', '101-binary', 0), [{ id: '103', options: {} }]);
  assert.deepEqual(await run('Lampe (Salon)', '101-brightness', 50), [
    { id: '104', options: { slider: 50 } },
  ]);
  assert.deepEqual(await run('Lampe (Salon)', '101-brightness', 150), [
    { id: '104', options: { slider: 99 } },
  ]);
  assert.deepEqual(await run('Ampoule couleur (Salon)', '116-color', 0x00ff00), [
    { id: '117', options: { color: '#00ff00' } },
  ]);
  assert.deepEqual(await run('Volet (Salon)', '132-state', -1), [{ id: '133', options: {} }]);
  assert.deepEqual(await run('Volet (Salon)', '132-state', 0), [{ id: '134', options: {} }]);
  assert.deepEqual(await run('Volet (Salon)', '131-position', 30), [
    { id: '135', options: { slider: 30 } },
  ]);
  assert.deepEqual(await run('Thermostat (Cuisine)', '151-setpoint', 21.5), [
    { id: '152', options: { slider: 21.5 } },
  ]);
  assert.deepEqual(await run('Thermostat (Cuisine)', '154-mode', 'Eco'), [
    { id: '156', options: {} },
  ]);
  assert.deepEqual(await run('Mode maison', '211-mode', 'Nuit'), [
    { id: '212', options: { select: '3' } },
  ]);
  assert.deepEqual(await run('Serrure (Garage)', '171-binary', 0), [{ id: '172', options: {} }]);

  // A gate with a toggle only: toggled when it is not already where asked.
  const gate = await created(gladys, 'Portail (Garage)');
  assert.deepEqual(await run('Portail (Garage)', '242-state', -1), [], 'already closed');
  assert.deepEqual(await run('Portail (Garage)', '242-state', 1), [{ id: '242', options: {} }]);
  await tick(TIMINGS.flushInterval);
  assert.equal(
    gladys.fake.lastState(`${gate.external_id}:242-state`),
    1,
    'without an info command, Gladys keeps the value sent',
  );

  const plug = deviceNamed(gladys, 'Prise TV (Salon)');
  const refused = await gladys.fake.setValue(plug, featureOf(plug, '124-sensor'), 1);
  assert.equal(refused.success, false, 'a sensor cannot be controlled');

  box.execErrors['122'] = new JeedomError('api', 'Cette action nécessite un code d’accès', {
    code: 5,
  });
  const failed = await gladys.fake.setValue(plug, featureOf(plug, '121-binary'), 1);
  assert.equal(failed.success, false);
  assert.match(failed.error, /code d’accès/);
});

test('a failure marks Jeedom unreachable, the reconnection reads the inventory again', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const plug = await created(gladys, 'Prise TV (Salon)');
  box.fail = new JeedomError('network', 'connection refused');
  await tick(POLL);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable: connection refused/);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: PLUG,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  const offline = await gladys.fake.setValue(plug, featureOf(plug, '121-binary'), 1);
  assert.equal(offline.success, false);
  assert.match(offline.error, /not connected/);

  // Missed while unreachable: the inventory brings it back.
  box.fail = undefined;
  box.cmds.find((c) => c.id === '121').currentValue = '0';
  const inventories = box.callsOf('cmd::all').length;
  await tick(TIMINGS.retryMin);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(box.callsOf('cmd::all').length, inventories + 1);
  assert.equal(gladys.fake.lastState(`${PLUG}:121-binary`), 0);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: PLUG,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('the retries slow down, a refused API key is retried every few minutes', async (t) => {
  const { gladys, box, tick } = await setup(t, {
    jeedom_url: 'http://jeedom.lan',
    api_key: 'not-the-right-key-at-all',
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
  const attempts = box.calls.length;
  await tick(TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts);
  await tick(TIMINGS.authRetry - TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts + 1);
});

test('the connection test shows the version and what is offered', async (t) => {
  const { gladys, box } = await setup(t);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connection OK, Jeedom 4.4.19: 15 equipments, 58 commands. 12 devices offered in Discovery, 3 left out (1 disabled, 1 hidden, 1 with nothing to offer).',
  );
  assert.match(ack.data.message.fr, /^Connexion OK, Jeedom 4\.4\.19 : 15 équipements/);
  assert.equal(box.clients.at(-1).closed, true, 'the test client is closed');

  box.fail = new JeedomError('http', 'HTTP 404');
  const down = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(down.data.message.en, /unreachable: HTTP 404\. Check the address/);
});

test('without an address or a key, the status says what to fill in', async (t) => {
  const { gladys, box } = await setup(t, { jeedom_url: '', api_key: '' });
  assert.equal(gladys.fake.connectionStatus.message.en, T.notConfigured.en);
  assert.equal(box.clients.length, 0);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.deepEqual(ack.data.message, T.notConfigured);

  await gladys.fake.configUpdated({ jeedom_url: '192.168.1.20', api_key: '' });
  assert.equal(gladys.fake.connectionStatus.message.en, T.noKey.en);
  await gladys.fake.configUpdated({ jeedom_url: '192.168.1.20', api_key: API_KEY });
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an equipment enabled in Jeedom shows up, a widget refresh changes nothing', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const update = (id, enable) => {
    box.clock += 0.25;
    box.events.push({
      datetime: String(box.clock),
      name: 'eqLogic::update',
      option: { eqLogic_id: id, visible: '1', enable },
    });
  };
  update('12', '1');
  await tick(POLL);
  await tick(TIMINGS.inventoryDebounce);
  assert.equal(box.callsOf('cmd::all').length, 1);

  box.eqLogics.find((e) => e.id === '19').isEnable = '1';
  update('19', '1');
  await tick(POLL);
  assert.equal(gladys.fake.discoveredDevices.length, 12);
  await tick(TIMINGS.inventoryDebounce);
  assert.equal(gladys.fake.discoveredDevices.length, 13);
  assert.ok(deviceNamed(gladys, 'Ancien module (Salon)'));
});

test('the ONLINE command drives the transport badge', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const sensor = await created(gladys, 'Capteur (Salon)');
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
  box.emit('165', '0');
  await tick(POLL);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: sensor.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
});

test('Scan reads the inventory again, a new configuration reconnects', async (t) => {
  const { gladys, box } = await setup(t);
  await gladys.fake.scanRequest();
  assert.equal(box.callsOf('cmd::all').length, 2);

  await gladys.fake.configUpdated({ jeedom_url: 'https://jeedom.lan/', api_key: API_KEY });
  assert.equal(box.clients[0].closed, true);
  assert.equal(box.clients.at(-1).config.url, 'https://jeedom.lan/core/api/jeeApi.php');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
