import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory, linkedId, normalizeCmd, parseListValue } from '../src/inventory.js';
import { inventoryAnswers } from './fixtures/jeedom.js';

test('enabled and visible equipment, with or without a room', () => {
  const inventory = buildInventory(inventoryAnswers());
  assert.equal(inventory.equipments.length, 13);
  assert.deepEqual(inventory.skipped, { disabled: 1, hidden: 1 });
  assert.equal(inventory.commands, 58);
  const door = inventory.equipments.find((e) => e.id === '14');
  assert.deepEqual(
    [door.name, door.objectId, door.objectName, door.plugin],
    ["Porte d'entrée", undefined, undefined, 'zigbee'],
  );
  const lock = inventory.equipments.find((e) => e.id === '17');
  assert.equal(lock.objectName, 'Garage', 'a hidden room still names its equipment');
  assert.deepEqual(
    lock.cmds.map((c) => c.id),
    ['171', '172', '173'],
  );
});

test('Jeedom 4.6 answers numbers where 4.4 answered strings', () => {
  // Shapes copied from a real Jeedom 4.6.1.
  const inventory = buildInventory({
    objects: [{ id: 2, name: 'Cuisine', father_id: null, isVisible: 1 }],
    eqLogics: [
      {
        id: 3,
        name: 'Capteur',
        object_id: 2,
        eqType_name: 'gladyse2e',
        isVisible: 1,
        isEnable: 1,
        configuration: { createtime: '2026-10-15 20:07:56' },
        display: { 'backGraph::info': 0 },
        order: 9999,
        status: { lastCommunication: '2026-10-15 20:07:57', timeout: 0, warning: 0, danger: 0 },
        cache: [],
      },
    ],
    cmds: [
      {
        id: 1,
        generic_type: 'LIGHT_STATE',
        name: 'Etat',
        order: 0,
        type: 'info',
        subType: 'numeric',
        eqLogic_id: 3,
        unite: '%',
        configuration: { minValue: 0, maxValue: 99 },
        display: { showStatsOnmobile: 0 },
        value: null,
        isVisible: 0,
        currentValue: 0,
      },
      {
        id: 2,
        generic_type: 'LIGHT_ON',
        name: 'On',
        order: 0,
        type: 'action',
        subType: 'other',
        eqLogic_id: 3,
        configuration: { value: 99 },
        display: [],
        value: '1',
        isVisible: 1,
        currentValue: null,
      },
    ],
  });
  const [eq] = inventory.equipments;
  assert.deepEqual([eq.id, eq.objectName], ['3', 'Cuisine']);
  assert.deepEqual(
    eq.cmds.map((c) => [c.id, c.eqLogicId, c.visible, c.min, c.max, c.link, c.value]),
    [
      ['1', '3', false, 0, 99, undefined, 0],
      ['2', '3', true, undefined, undefined, '1', undefined],
    ],
  );
});

test('Jeedom answers "ok" for an empty list', () => {
  const inventory = buildInventory({ objects: 'ok', eqLogics: 'ok', cmds: 'ok' });
  assert.deepEqual(inventory, { equipments: [], skipped: { disabled: 0, hidden: 0 }, commands: 0 });
});

test('a command, normalized', () => {
  assert.deepEqual(
    normalizeCmd({
      id: 5,
      eqLogic_id: 2,
      name: ' Consigne ',
      type: 'action',
      subType: 'slider',
      generic_type: 'thermostat_set_setpoint',
      unite: '°C',
      value: '#4#',
      configuration: { minValue: '7', maxValue: '30,5' },
      display: { invertBinary: '1' },
      isVisible: '0',
      order: '3',
      currentValue: '19',
    }),
    {
      id: '5',
      eqLogicId: '2',
      name: 'Consigne',
      type: 'action',
      subType: 'slider',
      genericType: 'THERMOSTAT_SET_SETPOINT',
      unit: '°C',
      link: '4',
      min: 7,
      max: 30.5,
      listValue: [],
      visible: false,
      invert: true,
      order: 3,
      value: undefined,
    },
  );
  const bare = normalizeCmd({ id: '6', type: 'info', configuration: [], display: [] });
  assert.deepEqual(
    [bare.min, bare.max, bare.invert, bare.visible],
    [undefined, undefined, false, true],
  );
});

test('links and list values', () => {
  assert.equal(linkedId('12'), '12');
  assert.equal(linkedId('#12#'), '12');
  assert.equal(linkedId('#[Salon][Lampe][Etat]#'), undefined);
  assert.equal(linkedId(null), undefined);
  assert.deepEqual(parseListValue('1|Comfort;2|Eco|night'), [
    { value: '1', label: 'Comfort' },
    { value: '2', label: 'Eco|night' },
  ]);
  assert.deepEqual(parseListValue('on;off;'), [
    { value: 'on', label: 'on' },
    { value: 'off', label: 'off' },
  ]);
  assert.deepEqual(parseListValue(undefined), []);
});
