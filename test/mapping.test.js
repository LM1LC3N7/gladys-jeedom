import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { buildInventory, normalizeCmd } from '../src/inventory.js';
import {
  COVER_STATE,
  OPENING_SENSOR_STATE,
  colorToInt,
  electricSpec,
  intToColor,
  mapEquipment,
  pairActions,
  toBinary,
  toNumber,
  unitOf,
} from '../src/mapping.js';
import { inventoryAnswers } from './fixtures/jeedom.js';

const inventory = buildInventory(inventoryAnswers());
const mapped = (id) => mapEquipment(inventory.equipments.find((e) => e.id === String(id)));

/** An equipment built from raw cmd::all entries. */
const equipment = (cmds) => ({
  id: '99',
  name: 'Test',
  cmds: cmds.map((c, i) =>
    normalizeCmd({ id: String(900 + i), eqLogic_id: '99', isVisible: '1', ...c }),
  ),
});

const feature = (m, key) => {
  const f = m.features.find((x) => x.key === key);
  assert.ok(f, `feature ${key} in ${m.features.map((x) => x.key).join(', ')}`);
  return f;
};

/** What the readers of a command make of a value: { key: state | text }. */
const read = (m, cmdId, raw) =>
  Object.fromEntries(
    m.readers
      .filter((r) => r.cmdId === String(cmdId))
      .map((r) => {
        const value = r.read(raw);
        return [r.key, value === null ? null : (value.state ?? value.text)];
      }),
  );

const write = (m, key, value, raw = () => undefined) => m.writers[key].write(value, raw);

test('a dimmer: on/off from its numeric state, brightness from its slider', () => {
  const m = mapped(10);
  assert.deepEqual(
    m.features.map((f) => f.key),
    ['101-binary', '101-brightness'],
  );
  assert.deepEqual(feature(m, '101-binary'), {
    key: '101-binary',
    name: 'On',
    category: C.LIGHT,
    type: T.LIGHT.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
    keep_history: true,
  });
  const brightness = feature(m, '101-brightness');
  assert.equal(brightness.name, 'Intensité');
  assert.deepEqual([brightness.min, brightness.max, brightness.unit], [0, 99, U.PERCENT]);
  assert.deepEqual(read(m, 101, '42'), { '101-binary': 1, '101-brightness': 42 });
  assert.deepEqual(read(m, 101, '0'), { '101-binary': 0, '101-brightness': 0 });
  assert.deepEqual(read(m, 101, ''), { '101-binary': null, '101-brightness': null });
  assert.deepEqual(write(m, '101-brightness', 120.4), [{ id: '104', options: { slider: 99 } }]);
});

test('a color bulb: state, brightness, color and color temperature', () => {
  const m = mapped(11);
  assert.deepEqual(
    m.features.map((f) => f.key),
    ['111-binary', '114-brightness', '116-color', '118-temperature'],
  );
  assert.deepEqual([feature(m, '114-brightness').min, feature(m, '114-brightness').max], [0, 254]);
  const temperature = feature(m, '118-temperature');
  assert.deepEqual([temperature.type, temperature.min, temperature.max], ['temperature', 153, 500]);
  assert.equal(temperature.unit, undefined);
  assert.deepEqual(read(m, 116, '#FF8000'), { '116-color': 0xff8000 });
  assert.deepEqual(read(m, 116, 'red'), { '116-color': null });
  assert.deepEqual(write(m, '116-color', 255), [{ id: '117', options: { color: '#0000ff' } }]);
  assert.deepEqual(write(m, '118-temperature', 250), [{ id: '119', options: { slider: 250 } }]);
});

test('a metering plug: its measurements are switch features', () => {
  const m = mapped(12);
  const spec = (key) => {
    const f = feature(m, key);
    return [f.category, f.type, f.unit];
  };
  assert.deepEqual(spec('121-binary'), [C.SWITCH, T.SWITCH.BINARY, undefined]);
  assert.deepEqual(spec('124-sensor'), [C.SWITCH, T.SWITCH.POWER, U.WATT]);
  assert.deepEqual(spec('125-sensor'), [C.SWITCH, T.SWITCH.ENERGY, U.KILOWATT_HOUR]);
  assert.deepEqual(spec('126-sensor'), [C.SWITCH, T.SWITCH.VOLTAGE, U.VOLT]);
  assert.deepEqual(write(m, '121-binary', 0), [{ id: '123', options: {} }], '#121# links too');
  assert.deepEqual([...m.throttled].sort(), ['124-sensor', '125-sensor', '126-sensor']);
});

test('a meter: energy-sensor features, the consumption an index, the unit decides', () => {
  const m = mapEquipment(
    equipment([
      { type: 'info', subType: 'numeric', generic_type: 'POWER', unite: 'kW', name: 'P' },
      { type: 'info', subType: 'numeric', generic_type: 'CONSUMPTION', unite: 'Wh', name: 'E' },
      { type: 'info', subType: 'numeric', generic_type: 'POWER', unite: 'kWh', name: 'Typo' },
    ]),
  );
  const spec = (key) => {
    const f = feature(m, key);
    return [f.category, f.type, f.unit];
  };
  assert.deepEqual(spec('900-sensor'), [C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.KILOWATT]);
  assert.deepEqual(spec('901-sensor'), [C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, U.WATT_HOUR]);
  assert.deepEqual(
    spec('902-sensor'),
    [C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, U.KILOWATT_HOUR],
    'a POWER in kWh is an energy',
  );
  assert.deepEqual(electricSpec('PRODUCTION', 'W', false).type, T.ENERGY_PRODUCTION_SENSOR.POWER);
  assert.deepEqual(electricSpec('PRODUCTION', 'kWh', false).type, T.ENERGY_PRODUCTION_SENSOR.INDEX);
  assert.deepEqual(electricSpec('VOLTAGE', '', false).unit, U.VOLT);
  assert.deepEqual(electricSpec('POWER', 'A', true).type, T.SWITCH.CURRENT);
});

test('a shutter: position from its numeric state, open / close / stop buttons', () => {
  const m = mapped(13);
  const position = feature(m, '131-position');
  assert.deepEqual(
    [position.category, position.type, position.min, position.max],
    [C.SHUTTER, T.SHUTTER.POSITION, 0, 99],
  );
  const state = feature(m, '132-state');
  assert.deepEqual([state.type, state.min, state.max, state.has_feedback], ['state', -1, 1, false]);
  assert.deepEqual(write(m, '132-state', COVER_STATE.OPEN), [{ id: '132', options: {} }]);
  assert.deepEqual(write(m, '132-state', COVER_STATE.CLOSE), [{ id: '133', options: {} }]);
  assert.deepEqual(write(m, '132-state', COVER_STATE.STOP), [{ id: '134', options: {} }]);
  assert.deepEqual(read(m, 131, '99'), { '131-position': 99 });
});

test('a shutter with a binary state, or a slider only', () => {
  const binary = mapEquipment(
    equipment([
      { type: 'info', subType: 'binary', generic_type: 'FLAP_STATE', name: 'Etat' },
      { type: 'action', subType: 'other', generic_type: 'FLAP_UP', name: 'Up', value: '900' },
      { type: 'action', subType: 'other', generic_type: 'FLAP_DOWN', name: 'Down', value: '900' },
    ]),
  );
  assert.equal(feature(binary, '900-state').has_feedback, true);
  assert.deepEqual(read(binary, 900, '1'), { '900-state': COVER_STATE.OPEN });
  assert.deepEqual(read(binary, 900, '0'), { '900-state': COVER_STATE.CLOSE });
  assert.throws(() => write(binary, '900-state', COVER_STATE.STOP), /cannot be stopped/);

  const slider = mapEquipment(
    equipment([
      {
        type: 'action',
        subType: 'slider',
        generic_type: 'FLAP_SLIDER',
        name: 'Position',
        configuration: { minValue: '0', maxValue: '100' },
      },
    ]),
  );
  assert.deepEqual(
    slider.features.map((f) => f.key),
    ['900-position'],
  );
  assert.ok(slider.optimistic.has('900-position'));
});

test('door sensors: Jeedom 1 = open, Gladys 1 = closed', () => {
  const m = mapped(14);
  const opening = feature(m, '141-sensor');
  assert.deepEqual([opening.category, opening.type], [C.OPENING_SENSOR, T.SENSOR.BINARY]);
  assert.deepEqual(read(m, 141, '1'), { '141-sensor': OPENING_SENSOR_STATE.OPEN });
  assert.deepEqual(read(m, 141, '0'), { '141-sensor': OPENING_SENSOR_STATE.CLOSE });
  const battery = feature(m, '142-sensor');
  assert.deepEqual(
    [battery.category, battery.type, battery.unit],
    [C.BATTERY, T.BATTERY.INTEGER, U.PERCENT],
    'a hidden command with a generic type is offered',
  );
});

test('a thermostat: setpoint, temperature, mode list, heating state', () => {
  const m = mapped(15);
  const setpoint = feature(m, '151-setpoint');
  assert.deepEqual(
    [setpoint.category, setpoint.type, setpoint.unit, setpoint.min, setpoint.max],
    [C.THERMOSTAT, T.THERMOSTAT.TARGET_TEMPERATURE, U.CELSIUS, 7, 30],
  );
  assert.deepEqual(write(m, '151-setpoint', 21.5), [{ id: '152', options: { slider: 21.5 } }]);
  assert.equal(feature(m, '153-sensor').category, C.TEMPERATURE_SENSOR);
  const mode = feature(m, '154-mode');
  assert.deepEqual(
    [mode.category, mode.type, mode.keep_history, mode.has_feedback],
    [C.TEXT, T.TEXT.SELECT, false, true],
  );
  assert.deepEqual(mode.supported_options, [
    { value: 'Confort', label: 'Confort', sort_order: 0 },
    { value: 'Eco', label: 'Eco', sort_order: 1 },
    { value: 'Off', label: 'Off', sort_order: 2 },
  ]);
  assert.deepEqual(read(m, 154, 'Eco'), { '154-mode': 'Eco' });
  assert.deepEqual(write(m, '154-mode', 'Off'), [{ id: '157', options: {} }]);
  assert.throws(() => write(m, '154-mode', 'Boost'), /not a mode/);
  assert.deepEqual(
    [feature(m, '158-sensor').type, read(m, 158, '1')['158-sensor']],
    [T.THERMOSTAT.OPERATING_STATE, 1],
  );
  assert.equal(feature(m, '159-text').type, T.TEXT.TEXT);
});

test('a multisensor: decimal comma, hand-typed unit, ONLINE kept for the badge', () => {
  const m = mapped(16);
  assert.deepEqual(read(m, 161, '21,5'), { '161-sensor': 21.5 });
  assert.equal(feature(m, '164-sensor').unit, U.LUX);
  assert.equal(feature(m, '163-sensor').category, C.MOTION_SENSOR);
  assert.equal(m.online, '165');
  assert.ok(!m.features.some((f) => f.key.startsWith('165')));
});

test('a lock: 1 = locked, LOCK_CLOSE locks', () => {
  const m = mapped(17);
  assert.deepEqual([feature(m, '171-binary').category], [C.LOCK]);
  assert.deepEqual(write(m, '171-binary', 1), [{ id: '173', options: {} }]);
  assert.deepEqual(write(m, '171-binary', 0), [{ id: '172', options: {} }]);
});

test('visible info commands without generic type: a value or a text', () => {
  const m = mapped(18);
  assert.deepEqual(
    m.features.map((f) => [f.key, f.category, f.type, f.unit]),
    [
      ['181-value', C.UNKNOWN, T.UNKNOWN.UNKNOWN, U.LITER],
      ['182-text', C.TEXT, T.TEXT.TEXT, undefined],
      ['183-value', C.UNKNOWN, T.UNKNOWN.UNKNOWN, undefined],
    ],
    'hidden, DONT and action commands are left out',
  );
  assert.deepEqual(read(m, 183, '0'), { '183-value': 1 }, 'invertBinary is honored');
  assert.deepEqual(read(m, 182, 'Bonjour'), { '182-text': 'Bonjour' });
  assert.equal(feature(m, '182-text').keep_history, false);
});

test('a mode list action: options from listValue, the info read by label', () => {
  const m = mapped(21);
  assert.deepEqual(
    feature(m, '211-mode').supported_options.map((o) => [o.value, o.label]),
    [
      ['1', 'Présent'],
      ['2', 'Absent'],
      ['3', 'Nuit'],
    ],
  );
  assert.deepEqual(read(m, 211, 'Absent'), { '211-mode': '2' });
  assert.deepEqual(write(m, '211-mode', '3'), [{ id: '212', options: { select: '3' } }]);
  assert.deepEqual(write(m, '211-mode', 'Nuit'), [{ id: '212', options: { select: '3' } }]);
});

test('a gate: Z-Wave barrier state, toggle only when needed', () => {
  const m = mapped(24);
  assert.deepEqual(read(m, 241, '0'), { '241-sensor': OPENING_SENSOR_STATE.CLOSE });
  assert.deepEqual(read(m, 241, '255'), { '241-sensor': OPENING_SENSOR_STATE.OPEN });
  assert.deepEqual(read(m, 241, '254'), { '241-sensor': OPENING_SENSOR_STATE.OPEN });
  const closed = () => '0';
  assert.deepEqual(write(m, '242-state', -1, closed), []);
  assert.deepEqual(write(m, '242-state', 1, closed), [{ id: '242', options: {} }]);
  assert.deepEqual(
    write(m, '242-state', -1, () => '255'),
    [{ id: '242', options: {} }],
  );
  assert.throws(() => write(m, '242-state', 0), /cannot be stopped/);
});

test('two channels in one equipment are paired by the links of their actions', () => {
  const m = mapEquipment(
    equipment([
      { type: 'info', subType: 'binary', generic_type: 'ENERGY_STATE', name: 'Etat 1' },
      { type: 'info', subType: 'binary', generic_type: 'ENERGY_STATE', name: 'Etat 2' },
      { type: 'action', subType: 'other', generic_type: 'ENERGY_ON', name: 'On 2', value: '901' },
      { type: 'action', subType: 'other', generic_type: 'ENERGY_ON', name: 'On 1', value: '900' },
      { type: 'action', subType: 'other', generic_type: 'ENERGY_OFF', name: 'Off 1', value: '900' },
      { type: 'action', subType: 'other', generic_type: 'ENERGY_OFF', name: 'Off 2', value: '901' },
    ]),
  );
  assert.deepEqual(
    m.features.map((f) => f.key),
    ['900-binary', '901-binary'],
  );
  assert.deepEqual(write(m, '900-binary', 1), [{ id: '903', options: {} }]);
  assert.deepEqual(write(m, '901-binary', 1), [{ id: '902', options: {} }]);
  assert.deepEqual(write(m, '901-binary', 0), [{ id: '905', options: {} }]);
});

test('a light with a toggle only: toggled when the state differs', () => {
  const m = mapEquipment(
    equipment([
      { type: 'info', subType: 'binary', generic_type: 'LIGHT_STATE', name: 'Etat' },
      { type: 'action', subType: 'other', generic_type: 'LIGHT_TOGGLE', name: 'Toggle' },
    ]),
  );
  assert.deepEqual(
    write(m, '900-binary', 1, () => '0'),
    [{ id: '901', options: {} }],
  );
  assert.deepEqual(
    write(m, '900-binary', 1, () => '1'),
    [],
  );
});

test('actions without a state: write only, optimistic', () => {
  const m = mapEquipment(
    equipment([
      { type: 'action', subType: 'other', generic_type: 'ENERGY_ON', name: 'On' },
      { type: 'action', subType: 'other', generic_type: 'ENERGY_OFF', name: 'Off' },
    ]),
  );
  const f = feature(m, '900-binary');
  assert.deepEqual([f.read_only, f.has_feedback], [false, false]);
  assert.ok(m.optimistic.has('900-binary'));
  assert.deepEqual(m.readers, []);
});

test('pairActions keeps the actions it cannot pair as groups of their own', () => {
  const s = { id: '1' };
  const groups = pairActions([s], {
    on: [{ id: 'a', link: '1' }, { id: 'b' }],
    off: [{ id: 'c', link: '7' }],
  });
  assert.deepEqual(groups, [
    { state: s, on: { id: 'a', link: '1' }, off: { id: 'c', link: '7' } },
    { on: { id: 'b' } },
  ]);
});

test('values and units', () => {
  assert.equal(toNumber(' 12,5 '), 12.5);
  assert.equal(toNumber(''), undefined);
  assert.equal(toNumber('abc'), undefined);
  assert.equal(toNumber(true), 1);
  assert.deepEqual(['1', '0', '255', 'on', 'OFF', 'maybe', null].map(toBinary), [
    1,
    0,
    1,
    1,
    0,
    undefined,
    undefined,
  ]);
  assert.equal(colorToInt('ff0000'), 0xff0000);
  assert.equal(intToColor(0x00ff00), '#00ff00');
  assert.equal(intToColor(-5), '#000000');
  assert.equal(unitOf('°C'), U.CELSIUS);
  assert.equal(unitOf('Kwh'), U.KILOWATT_HOUR);
  assert.equal(unitOf('w'), U.WATT);
  assert.equal(unitOf('mb'), U.MILLIBAR);
  assert.equal(unitOf('MB'), U.MEGABYTE);
  assert.equal(unitOf('furlongs'), undefined);
  assert.equal(unitOf(''), undefined);
});
