import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildModel, deviceName } from '../src/devices.js';
import { buildInventory } from '../src/inventory.js';
import { inventoryAnswers } from './fixtures/jeedom.js';

const gladys = createFakeGladys();
const model = buildModel(
  (id) => gladys.externalIds('jeedom', id),
  buildInventory(inventoryAnswers()),
);

test('one device per equipment, stable external ids', () => {
  assert.equal(model.devices.length, 12);
  assert.deepEqual(model.counts, { equipments: 13, empty: 1, overflow: 0 });
  const lamp = model.devices.find((d) => d.external_id === 'ext:test-integration:jeedom:10');
  assert.equal(lamp.name, 'Lampe (Salon)');
  assert.equal(lamp.should_poll, false);
  assert.deepEqual(
    lamp.features.map((f) => f.external_id),
    ['ext:test-integration:jeedom:10:101-binary', 'ext:test-integration:jeedom:10:101-brightness'],
  );
  assert.ok(lamp.features.every((f) => !('key' in f)));
});

test('Gladys accepts the devices (categories, types, units)', async () => {
  await gladys.publishDiscoveredDevices(model.devices);
  assert.equal(gladys.fake.discoveredDevices.length, 12);
});

test('the routing tables', () => {
  assert.deepEqual(
    model.readers.get('101').map((r) => r.featureId),
    ['ext:test-integration:jeedom:10:101-binary', 'ext:test-integration:jeedom:10:101-brightness'],
  );
  assert.ok(model.writers.has('ext:test-integration:jeedom:13:135-position') === false);
  assert.ok(model.writers.has('ext:test-integration:jeedom:13:131-position'));
  assert.ok(model.throttled.has('ext:test-integration:jeedom:16:161-sensor'));
  assert.ok(
    !model.throttled.has('ext:test-integration:jeedom:16:163-sensor'),
    'motion is an event',
  );
  assert.ok(model.optimistic.has('ext:test-integration:jeedom:24:242-state'));
  assert.deepEqual([...model.online], [['ext:test-integration:jeedom:16', '165']]);
});

test('the room is part of the name', () => {
  assert.equal(deviceName({ name: 'Lampe', objectName: 'Cuisine' }), 'Lampe (Cuisine)');
  assert.equal(deviceName({ name: 'Lampe' }), 'Lampe');
});
