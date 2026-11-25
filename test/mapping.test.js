import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { buildInventory, normalizeCmd } from '../src/inventory.js';
import {
  COVER_STATE,
  OPENING_SENSOR_STATE,
  PILOT_WIRE_MODE,
  colorToInt,
  electricSpec,
  intToColor,
  mapEquipment,
  pairActions,
  pilotWireModeOfName,
  qubinoPilotWireMode,
  toBinary,
  toNumber,
  unitOf,
} from '../src/mapping.js';
import { inventoryAnswers } from './fixtures/jeedom.js';

// The thermostat fallbacks of the core, when a Gladys clone is at hand (not on GitHub CI).
const CORE_THERMOSTAT = '/home/claude/code/Gladys/server/utils/thermostatConstants.js';
const { supportedStandbyOrder, supportedPilotWireOrder } = existsSync(CORE_THERMOSTAT)
  ? createRequire(import.meta.url)(CORE_THERMOSTAT)
  : {};

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

// --- Pilot wire heaters ---------------------------------------------------------

const QUBINO_LEVELS = [
  [0, PILOT_WIRE_MODE.OFF],
  [10, PILOT_WIRE_MODE.OFF],
  [11, PILOT_WIRE_MODE.FROST_PROTECTION],
  [20, PILOT_WIRE_MODE.FROST_PROTECTION],
  [21, PILOT_WIRE_MODE.ECO],
  [30, PILOT_WIRE_MODE.ECO],
  [31, PILOT_WIRE_MODE.COMFORT_2],
  [40, PILOT_WIRE_MODE.COMFORT_2],
  [41, PILOT_WIRE_MODE.COMFORT_1],
  [50, PILOT_WIRE_MODE.COMFORT_1],
  [51, PILOT_WIRE_MODE.COMFORT],
  [99, PILOT_WIRE_MODE.COMFORT],
];

test('the Gladys pilot wire values are those of the core', () => {
  assert.deepEqual(PILOT_WIRE_MODE, {
    OFF: 0,
    FROST_PROTECTION: 1,
    ECO: 2,
    COMFORT_1: 3,
    COMFORT_2: 4,
    COMFORT: 5,
  });
});

test('a Qubino pilot wire (Z-Wave JS plugin) is a pilot wire mode, not a switch', () => {
  const m = mapped(26);
  assert.deepEqual(
    m.features.map((f) => f.key),
    ['261-pilotwire', '268-sensor'],
  );
  assert.deepEqual(feature(m, '261-pilotwire'), {
    key: '261-pilotwire',
    name: 'Radiateur Combles',
    category: C.HEATER,
    type: T.HEATER.PILOT_WIRE_MODE,
    min: 0,
    max: 5,
    read_only: false,
    has_feedback: true,
    keep_history: true,
    supported_options: [
      { value: 0, label: 'Arret' },
      { value: 1, label: 'Hors Gel' },
      { value: 2, label: 'Eco' },
      { value: 3, label: 'Confort -1' },
      { value: 4, label: 'Confort -2' },
      { value: 5, label: 'Confort' },
    ],
  });
  assert.equal(m.optimistic.size, 0);
  for (const [level, mode] of QUBINO_LEVELS) {
    assert.deepEqual(read(m, 261, String(level)), { '261-pilotwire': mode }, `level ${level}`);
  }
  for (const raw of ['255', '100', '-1', '', null, 'abc']) {
    assert.deepEqual(read(m, 261, raw), { '261-pilotwire': null }, `raw ${raw}`);
  }
  const sent = (mode) => write(m, '261-pilotwire', mode).map((c) => c.id);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((mode) => sent(mode)),
    [['262'], ['265'], ['264'], ['266'], ['267'], ['263']],
  );
  assert.deepEqual(write(m, '261-pilotwire', 1), [{ id: '265', options: {} }]);
  assert.deepEqual(sent('0'), ['262']);
  for (const bad of [6, -1, 2.5, 'x', '', ' ', null, undefined, true, NaN]) {
    assert.throws(() => write(m, '261-pilotwire', bad), /not a pilot wire order/, `${bad}`);
  }
});

test('qubinoPilotWireMode follows the ranges of the Qubino manual', () => {
  for (const [level, mode] of QUBINO_LEVELS) {
    assert.equal(qubinoPilotWireMode(level), mode);
  }
  assert.equal(qubinoPilotWireMode('45,5'), PILOT_WIRE_MODE.COMFORT_1);
  assert.equal(qubinoPilotWireMode(255), undefined);
  assert.equal(qubinoPilotWireMode(-0.5), undefined);
});

test('pilot wire order names', () => {
  const cases = {
    Arret: 0,
    Arrêt: 0,
    Off: 0,
    'pilot_wire_mode off': 0,
    'Hors Gel': 1,
    'Hors-gel': 1,
    HorsGel: 1,
    hors_gel: 1,
    frost_protection: 1,
    Eco: 2,
    Éco: 2,
    'Mode Eco': 2,
    'Confort -1': 3,
    'Confort-1': 3,
    'Confort -1°C': 3,
    'pilot_wire_mode comfort_-1': 3,
    'Confort -2 °C': 4,
    'comfort_-2': 4,
    Confort: 5,
    comfort: 5,
  };
  for (const [name, mode] of Object.entries(cases)) {
    assert.equal(pilotWireModeOfName(name), mode, name);
  }
  for (const name of [
    'Confort 19',
    'Confort +1',
    'Programme',
    '',
    'Mode',
    'On',
    'Etat',
    null,
    'Ecosse',
  ]) {
    assert.equal(pilotWireModeOfName(name), undefined, String(name));
  }
});

test('HEATING_STATE / ON / OFF without an order button stay a switch', () => {
  for (const subType of ['binary', 'numeric']) {
    const m = mapEquipment(
      equipment([
        { type: 'info', subType, name: 'Chauffage', generic_type: 'HEATING_STATE', value: 1 },
        { type: 'action', subType: 'other', name: 'On', generic_type: 'HEATING_ON', value: '900' },
        {
          type: 'action',
          subType: 'other',
          name: 'Off',
          generic_type: 'HEATING_OFF',
          value: '900',
        },
        // Order buttons whose names say nothing, or only what a relay does: not enough.
        { type: 'action', subType: 'other', name: 'Programme', generic_type: 'HEATING_OTHER' },
        { type: 'action', subType: 'other', name: 'Stop', generic_type: 'HEATING_OTHER' },
        { type: 'action', subType: 'other', name: 'Confort', generic_type: 'HEATING_OTHER' },
      ]),
    );
    assert.deepEqual(
      m.features.map((f) => [f.key, f.category, f.type]),
      [['900-binary', C.SWITCH, T.SWITCH.BINARY]],
      subType,
    );
    assert.deepEqual(write(m, '900-binary', 0), [{ id: '902', options: {} }]);
  }
});

test('a dimmer, a plug or a light is never a pilot wire', () => {
  for (const eq of inventory.equipments.filter((e) => e.id !== '26')) {
    assert.ok(
      mapEquipment(eq).features.every((f) => f.category !== C.HEATER),
      `equipment ${eq.id}`,
    );
  }
  // Order names on dimmer buttons: still a dimmer.
  const m = mapEquipment(
    equipment([
      { type: 'info', subType: 'numeric', name: 'Etat', generic_type: 'ENERGY_STATE' },
      { type: 'action', subType: 'other', name: 'Confort', generic_type: 'ENERGY_ON' },
      { type: 'action', subType: 'other', name: 'Eco', generic_type: 'ENERGY_OFF' },
      { type: 'action', subType: 'slider', name: 'Hors Gel', generic_type: 'ENERGY_SLIDER' },
    ]),
  );
  assert.deepEqual(
    m.features.map((f) => f.category),
    [C.SWITCH, C.SWITCH],
  );
});

test('a pilot wire whose state is a text (Edisio, Zigbee2MQTT enum)', () => {
  const m = mapEquipment(
    equipment([
      { type: 'info', subType: 'string', name: 'Etat', generic_type: 'HEATING_STATE' },
      { type: 'action', subType: 'other', name: 'On', generic_type: 'HEATING_ON' },
      { type: 'action', subType: 'other', name: 'Off', generic_type: 'HEATING_OFF' },
      { type: 'action', subType: 'other', name: 'Arrêt', generic_type: 'HEATING_OFF' },
      { type: 'action', subType: 'other', name: 'Hors-gel', generic_type: 'HEATING_OTHER' },
      { type: 'action', subType: 'other', name: 'Eco', generic_type: 'HEATING_OTHER' },
    ]),
  );
  const f = feature(m, '900-pilotwire');
  assert.deepEqual([f.category, f.read_only, f.has_feedback], [C.HEATER, false, true]);
  assert.deepEqual(f.supported_options, [
    { value: 0, label: 'Off' },
    { value: 1, label: 'Hors-gel' },
    { value: 2, label: 'Eco' },
    { value: 5, label: 'On' },
  ]);
  const states = ['On', 'Off', 'Arrêt', 'Hors-gel', 'eco', 'comfort_-1', 'Programme', ' '];
  assert.deepEqual(
    states.map((s) => read(m, 900, s)['900-pilotwire']),
    [5, 0, 0, 1, 2, 3, null, null],
  );
  assert.deepEqual(write(m, '900-pilotwire', 0), [{ id: '902', options: {} }]);
  assert.deepEqual(write(m, '900-pilotwire', 1), [{ id: '904', options: {} }]);
  assert.deepEqual(write(m, '900-pilotwire', 5), [{ id: '901', options: {} }]);
  assert.throws(() => write(m, '900-pilotwire', 3), /no command for the pilot wire order 3/);
});

test('a pilot wire whose numeric state says nothing sure is not read', () => {
  const m = mapEquipment({
    ...equipment([
      { type: 'info', subType: 'numeric', name: 'Etat', generic_type: 'HEATING_STATE' },
      { type: 'action', subType: 'other', name: 'Confort', generic_type: 'HEATING_ON' },
      { type: 'action', subType: 'other', name: 'Hors Gel', generic_type: 'HEATING_OTHER' },
    ]),
    plugin: 'heatzy',
  });
  assert.deepEqual(
    m.features.map((f) => f.key),
    ['900-pilotwire', '900-value'],
  );
  const f = feature(m, '900-pilotwire');
  assert.deepEqual([f.read_only, f.has_feedback], [false, false]);
  assert.ok(m.optimistic.has('900-pilotwire'));
  assert.deepEqual(read(m, 900, '1'), { '900-value': 1 });
  assert.deepEqual(write(m, '900-pilotwire', 1), [{ id: '902', options: {} }]);
  assert.throws(() => write(m, '900-pilotwire', 0), /no command for the pilot wire order 0/);
});

test('the pilot wire widgets of Jeedom say how a numeric state reads', () => {
  const eq = (template, plugin = 'openzwave') =>
    mapEquipment({
      ...equipment([
        {
          type: 'info',
          subType: 'numeric',
          name: 'Etat',
          generic_type: 'HEATING_STATE',
          template: { dashboard: template },
        },
        { type: 'action', subType: 'other', name: 'Eco', generic_type: 'HEATING_OTHER' },
      ]),
      plugin,
    });
  // Fibaro FGS221 (two relays): 0 comfort, 1 frost protection, 2 off, 3 eco.
  // Jeedom stores a core widget as "core::<name>"; the widget wins over the plugin.
  for (const [template, plugin] of [
    ['core::heatPiloteWire', 'openzwave'],
    ['heatPiloteWire', 'openzwave'],
    ['core::heatPiloteWire', 'zwavejs'],
  ]) {
    const fgs = eq(template, plugin);
    assert.deepEqual(
      ['0', '1', '2', '3', '4', '1.5'].map((v) => read(fgs, 900, v)['900-pilotwire']),
      [5, 1, 0, 2, null, null],
      `${template} ${plugin}`,
    );
  }
  for (const template of [
    'openzwave::heatpilotewire6ordres',
    'core::timeHeatPiloteWireQubino',
    'timeHeatPiloteWireQubino',
  ]) {
    const qubino = eq(template);
    assert.deepEqual(
      ['5', '15', '35', '99'].map((v) => read(qubino, 900, v)['900-pilotwire']),
      [0, 1, 4, 5],
      template,
    );
  }
  // The Z-Wave JS plugin whatever the widget.
  assert.equal(read(eq('core::default', 'zwavejs'), 900, '25')['900-pilotwire'], 2);
  assert.equal(eq('core::default').features[0].has_feedback, false);
  assert.equal(eq('core::someHeatPiloteWire').features[0].has_feedback, false);
});

test('two pilot wires of one equipment, each with its own buttons', () => {
  const m = mapEquipment({
    ...equipment([
      { type: 'info', subType: 'numeric', name: 'Etat 1', generic_type: 'HEATING_STATE' },
      { type: 'info', subType: 'numeric', name: 'Etat 2', generic_type: 'HEATING_STATE' },
      {
        type: 'action',
        subType: 'other',
        name: 'Eco 2',
        generic_type: 'HEATING_OTHER',
        value: '901',
      },
      {
        type: 'action',
        subType: 'other',
        name: 'Eco',
        generic_type: 'HEATING_OTHER',
        value: '901',
      },
      {
        type: 'action',
        subType: 'other',
        name: 'Eco',
        generic_type: 'HEATING_OTHER',
        value: '900',
      },
      {
        type: 'action',
        subType: 'other',
        name: 'Arret',
        generic_type: 'HEATING_OFF',
        value: '900',
      },
    ]),
    plugin: 'zwavejs',
  });
  assert.deepEqual(
    m.features.map((f) => f.key),
    ['900-pilotwire', '901-pilotwire'],
  );
  assert.deepEqual(
    m.features.map((f) => f.name),
    ['Etat 1', 'Etat 2'],
  );
  assert.deepEqual(write(m, '900-pilotwire', 2), [{ id: '904', options: {} }]);
  assert.deepEqual(write(m, '901-pilotwire', 2), [{ id: '903', options: {} }]);
  assert.throws(() => write(m, '901-pilotwire', 0), /order 0/);
});

test('the commands of a pilot wire are not paired again with another heater', () => {
  const m = mapEquipment({
    ...equipment([
      { type: 'info', subType: 'numeric', name: 'Fil pilote', generic_type: 'HEATING_STATE' },
      { type: 'info', subType: 'numeric', name: 'Relais', generic_type: 'HEATING_STATE' },
      {
        type: 'action',
        subType: 'other',
        name: 'Eco',
        generic_type: 'HEATING_OTHER',
        value: '900',
      },
      {
        type: 'action',
        subType: 'other',
        name: 'Arret',
        generic_type: 'HEATING_OFF',
        value: '900',
      },
      // A plain heater's buttons, linked to nothing.
      { type: 'action', subType: 'other', name: 'Marche', generic_type: 'HEATING_ON' },
      { type: 'action', subType: 'other', name: 'Stop', generic_type: 'HEATING_OFF' },
    ]),
    plugin: 'zwavejs',
  });
  assert.deepEqual(
    m.features.map((f) => [f.key, f.category]),
    [
      ['900-pilotwire', C.HEATER],
      ['901-binary', C.SWITCH],
    ],
  );
  assert.deepEqual(
    m.readers.map((r) => [r.cmdId, r.key]),
    [
      ['900', '900-pilotwire'],
      ['901', '901-binary'],
    ],
  );
  assert.deepEqual(write(m, '901-binary', 1), [{ id: '904', options: {} }]);
});

test('a binary pilot wire state is not read, even from the Z-Wave JS plugin', () => {
  const m = mapEquipment({
    ...equipment([
      { type: 'info', subType: 'binary', name: 'Etat', generic_type: 'HEATING_STATE' },
      { type: 'action', subType: 'other', name: 'Eco', generic_type: 'HEATING_OTHER' },
      { type: 'action', subType: 'other', name: 'Arrêt', generic_type: 'HEATING_OFF' },
    ]),
    plugin: 'zwavejs',
  });
  assert.equal(feature(m, '900-pilotwire').has_feedback, false);
  assert.ok(m.optimistic.has('900-pilotwire'));
  assert.ok(!m.readers.some((r) => r.key === '900-pilotwire'));
  assert.deepEqual(write(m, '900-pilotwire', 0), [{ id: '902', options: {} }]);
  // Decided: the state stays shown as it is, a read-only switch (nothing guessed).
  const shown = feature(m, '900-binary');
  assert.deepEqual([shown.category, shown.read_only], [C.SWITCH, true]);
  assert.deepEqual(read(m, 900, '1'), { '900-binary': 1 });
});

test('a heater with three orders publishes them: the thermostat falls back on off', () => {
  const m = mapEquipment(
    equipment([
      { type: 'info', subType: 'string', name: 'Etat', generic_type: 'HEATING_STATE' },
      { type: 'action', subType: 'other', name: 'Confort', generic_type: 'HEATING_ON' },
      { type: 'action', subType: 'other', name: 'Arrêt', generic_type: 'HEATING_OFF' },
      { type: 'action', subType: 'other', name: 'Eco', generic_type: 'HEATING_OTHER' },
    ]),
  );
  const f = feature(m, '900-pilotwire');
  assert.deepEqual(f.supported_options, [
    { value: 0, label: 'Arrêt' },
    { value: 2, label: 'Eco' },
    { value: 5, label: 'Confort' },
  ]);
  // The core's own fallbacks (server/utils/thermostatConstants.js), copied here
  // for the CI that has no Gladys clone, checked against it when there is one.
  const values = f.supported_options.map((o) => o.value);
  const pilot = (order) =>
    values.includes(order)
      ? order
      : [3, 4].includes(order) && values.includes(5)
        ? 5
        : order === 1 && values.includes(0)
          ? 0
          : null;
  const standby = (order) =>
    values.includes(order) ? order : (pilot(1) ?? (values.includes(2) ? 2 : null));
  assert.equal(standby(1), 0);
  assert.equal(pilot(3), 5);
  if (supportedStandbyOrder) {
    assert.equal(supportedStandbyOrder(1, f.supported_options), 0);
    assert.equal(supportedPilotWireOrder(1, f.supported_options), 0);
    assert.equal(supportedPilotWireOrder(4, f.supported_options), 5);
  }
  assert.deepEqual(write(m, '900-pilotwire', standby(1)), [{ id: '902', options: {} }]);
  assert.deepEqual(write(m, '900-pilotwire', pilot(3)), [{ id: '901', options: {} }]);
  // An order without a button is still refused, nothing sent.
  assert.throws(() => write(m, '900-pilotwire', 1), /no command for the pilot wire order 1/);
});

test('without a state, the feature id does not follow the display order', () => {
  const buttons = [
    { id: '951', type: 'action', subType: 'other', name: 'Eco', generic_type: 'HEATING_OTHER' },
    {
      id: '950',
      type: 'action',
      subType: 'other',
      name: 'Hors gel',
      generic_type: 'HEATING_OTHER',
    },
    { id: '952', type: 'action', subType: 'other', name: 'Arrêt', generic_type: 'HEATING_OFF' },
  ];
  const keys = (cmds) =>
    mapEquipment({
      id: '99',
      name: 'Test',
      cmds: cmds.map((c) => normalizeCmd({ eqLogic_id: '99', isVisible: '1', ...c })),
    }).features.map((f) => f.key);
  assert.deepEqual(keys(buttons), ['952-pilotwire']);
  assert.deepEqual(keys([...buttons].reverse()), ['952-pilotwire']);
  const on = {
    id: '953',
    type: 'action',
    subType: 'other',
    name: 'Confort',
    generic_type: 'HEATING_ON',
  };
  assert.deepEqual(keys([...buttons, on]), ['953-pilotwire']);
  assert.deepEqual(keys([on, ...buttons].reverse()), ['953-pilotwire']);
  // No ON nor OFF: the oldest button.
  assert.deepEqual(keys(buttons.slice(0, 2)), ['950-pilotwire']);
  assert.deepEqual(keys(buttons.slice(0, 2).reverse()), ['950-pilotwire']);
});
