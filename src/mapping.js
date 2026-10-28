// -----------------------------------------------------------------------------
// One Jeedom equipment -> Gladys features, readers and writers (pure).
//
// Jeedom describes what a command does with its generic type (generic_type):
// LIGHT_STATE, LIGHT_ON, FLAP_SLIDER, TEMPERATURE… An actuator is an info
// command (its state) plus action commands, each action pointing to the info
// it changes through its `value` field. `mapEquipment` returns:
//   features  the Gladys features (key relative to the device),
//   readers   [{ cmdId, key, read(rawValue) -> { state } | { text } | null }],
//   writers   { [key]: { write(value, raw) -> [{ id, options }], text } }
//             (one cmd::execCmd per entry; `raw(cmdId)` is the last value
//             read of an info command),
//   throttled the keys of the measurements (spaced by the sensor interval),
//   optimistic the keys without an info command: Gladys keeps the value sent,
//   online    the ONLINE info command, if any (transport badge).
// Value conventions: https://doc.jeedom.com/dev/fr_FR/cmd_value on the Jeedom
// side, server/utils/constants.js of the Gladys core on the other.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { LIMITS } from './constants.js';

// Value enums of the Gladys core (server/utils/constants.js), not in the SDK.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };

// --- Units -------------------------------------------------------------------

const UNITS = {
  '°C': U.CELSIUS,
  '° C': U.CELSIUS,
  '°F': U.FAHRENHEIT,
  K: U.KELVIN,
  '%': U.PERCENT,
  Pa: U.PASCAL,
  hPa: U.HECTO_PASCAL,
  kPa: U.KILO_PASCAL,
  bar: U.BAR,
  mbar: U.MILLIBAR,
  mb: U.MILLIBAR,
  psi: U.PSI,
  lx: U.LUX,
  lux: U.LUX,
  ppm: U.PPM,
  ppb: U.PPB,
  W: U.WATT,
  kW: U.KILOWATT,
  Wh: U.WATT_HOUR,
  kWh: U.KILOWATT_HOUR,
  MWh: U.MEGAWATT_HOUR,
  A: U.AMPERE,
  mA: U.MILLI_AMPERE,
  V: U.VOLT,
  mV: U.MILLI_VOLT,
  VA: U.VOLT_AMPERE,
  kVA: U.KILOVOLT_AMPERE,
  var: U.VOLT_AMPERE_REACTIVE,
  VAr: U.VOLT_AMPERE_REACTIVE,
  mm: U.MM,
  cm: U.CM,
  m: U.M,
  km: U.KM,
  '°': U.DEGREE,
  L: U.LITER,
  mL: U.MILLILITER,
  'm³': U.CUBIC_METER,
  m3: U.CUBIC_METER,
  'm³/h': U.CUBIC_METER_PER_HOUR,
  'm3/h': U.CUBIC_METER_PER_HOUR,
  '€': U.EURO,
  EUR: U.EURO,
  $: U.DOLLAR,
  '£': U.POUND_STERLING,
  'm/s': U.METER_PER_SECOND,
  'km/h': U.KILOMETER_PER_HOUR,
  mph: U.MILE_PER_HOUR,
  'mm/h': U.MILLIMETER_PER_HOUR,
  ms: U.MILLISECONDS,
  s: U.SECONDS,
  sec: U.SECONDS,
  min: U.MINUTES,
  h: U.HOURS,
  'µg/m³': U.MICROGRAM_PER_CUBIC_METER,
  'µg/m3': U.MICROGRAM_PER_CUBIC_METER,
  'μg/m³': U.MICROGRAM_PER_CUBIC_METER,
  'ug/m3': U.MICROGRAM_PER_CUBIC_METER,
  'mg/m³': U.MILLIGRAM_PER_CUBIC_METER,
  'mg/m3': U.MILLIGRAM_PER_CUBIC_METER,
  dB: U.DECIBEL,
  dBA: U.DECIBEL,
  AQI: U.AQI,
  UV: U.UV_INDEX,
  kB: U.KILOBYTE,
  MB: U.MEGABYTE,
  GB: U.GIGABYTE,
  'Mbit/s': U.MEGABITS_PER_SECOND,
  'kbit/s': U.KILOBITS_PER_SECOND,
};

// Case-insensitive fallback; "mb" stays millibar and "w" means watts (Jeedom
// users type units by hand: "Kwh", "w", "LUX"…).
const UNITS_LOWER = new Map([
  ...Object.entries(UNITS).map(([k, v]) => [k.toLowerCase(), v]),
  ['mb', U.MILLIBAR],
  ['w', U.WATT],
]);

/** The Gladys unit of a Jeedom unit, or undefined (Gladys refuses unknown units). */
export function unitOf(unit) {
  if (typeof unit !== 'string' || unit.trim() === '') {
    return undefined;
  }
  const text = unit.trim();
  return UNITS[text] ?? UNITS_LOWER.get(text.toLowerCase());
}

// --- Values ------------------------------------------------------------------

/** A Jeedom value as a finite number ("21,5" included), or undefined. */
export function toNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'boolean') {
    return raw ? 1 : 0;
  }
  const text = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (text === '') {
    return undefined;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

const TRUE_WORDS = new Set(['on', 'true', 'yes', 'oui', 'open', 'ouvert']);
const FALSE_WORDS = new Set(['off', 'false', 'no', 'non', 'closed', 'ferme', 'fermé']);

/** A Jeedom binary value: 0 is off, anything else is on (the Jeedom rule). */
export function toBinary(raw) {
  const n = toNumber(raw);
  if (n !== undefined) {
    return n !== 0 ? 1 : 0;
  }
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (TRUE_WORDS.has(text)) {
    return 1;
  }
  return FALSE_WORDS.has(text) ? 0 : undefined;
}

export const colorToInt = (raw) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(raw ?? '').trim());
  return match ? parseInt(match[1], 16) : undefined;
};

export const intToColor = (n) =>
  `#${Math.max(0, Math.min(0xffffff, Math.round(Number(n) || 0)))
    .toString(16)
    .padStart(6, '0')}`;

const cut = (text, max = LIMITS.text) => {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) : s;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const exec = (cmd, options = {}) => ({ id: cmd.id, options });

// --- Sensors -------------------------------------------------------------------

const decimal = (category, min, max, extra = {}) => ({
  category,
  type: T.SENSOR.DECIMAL,
  min,
  max,
  throttle: true,
  ...extra,
});

const binary = (category, type = T.SENSOR.BINARY, extra = {}) => ({
  category,
  type,
  min: 0,
  max: 1,
  binary: true,
  ...extra,
});

const TEMPERATURE = decimal(C.TEMPERATURE_SENSOR, -100, 150, { unit: U.CELSIUS });
const HUMIDITY = decimal(C.HUMIDITY_SENSOR, 0, 100, { unit: U.PERCENT });
const PRESSURE = decimal(C.PRESSURE_SENSOR, 0, 10_000);
const UV = {
  category: C.UV_SENSOR,
  type: T.UV_SENSOR.INTEGER,
  min: 0,
  max: 20,
  unit: U.UV_INDEX,
  throttle: true,
};
const AQI = {
  category: C.AIRQUALITY_SENSOR,
  type: T.AIRQUALITY_SENSOR.AQI,
  min: 0,
  max: 1000,
  unit: U.AQI,
  throttle: true,
};
const SPEED = { ...decimal(C.SPEED_SENSOR, 0, 10_000), type: T.SPEED_SENSOR.DECIMAL };
const LEAK = binary(C.LEAK_SENSOR);
const TEXT = { text: true };

// Jeedom: 0 = contact (closed), 1 = no contact (open). Gladys: OPEN 0, CLOSE 1.
const OPENING = binary(C.OPENING_SENSOR, T.SENSOR.BINARY, {
  convert: (b) => (b ? OPENING_SENSOR_STATE.OPEN : OPENING_SENSOR_STATE.CLOSE),
});
// Gates and garages: 0 = closed, 252 closing, 253 stopped, 254 opening, 255 open.
const BARRIER = binary(C.OPENING_SENSOR, T.SENSOR.BINARY, {
  raw: true,
  convert: (n) => (n === 0 ? OPENING_SENSOR_STATE.CLOSE : OPENING_SENSOR_STATE.OPEN),
});

/** Info generic types read as a sensor of their own. */
export const SENSORS = {
  TEMPERATURE,
  WEATHER_TEMPERATURE: TEMPERATURE,
  THERMOSTAT_TEMPERATURE: TEMPERATURE,
  // An outdoor probe stays out of the room average.
  THERMOSTAT_TEMPERATURE_OUTDOOR: { ...TEMPERATURE, type: T.TEMPERATURE_SENSOR.PROBE },
  HUMIDITY,
  WEATHER_HUMIDITY: HUMIDITY,
  THERMOSTAT_HUMIDITY: HUMIDITY,
  PRESSURE,
  WEATHER_PRESSURE: PRESSURE,
  BRIGHTNESS: decimal(C.LIGHT_SENSOR, 0, 200_000, { unit: U.LUX }),
  UV,
  WEATHER_UVINDEX: UV,
  CO2: decimal(C.CO2_SENSOR, 0, 100_000, { unit: U.PPM }),
  CO: decimal(C.CO_SENSOR, 0, 100_000, { unit: U.PPM, binaryVariant: binary(C.CO_SENSOR) }),
  NOISE: decimal(C.NOISE_SENSOR, 0, 200, { unit: U.DECIBEL }),
  AIR_QUALITY: AQI,
  AIRQUALITY_INDEX: AQI,
  AIRQUALITY_PM25: decimal(C.PM25_SENSOR, 0, 10_000, { unit: U.MICROGRAM_PER_CUBIC_METER }),
  PRESENCE: binary(C.MOTION_SENSOR),
  OCCUPANCY: binary(C.PRESENCE_SENSOR),
  SMOKE: binary(C.SMOKE_SENSOR),
  FLOOD: LEAK,
  WATER_LEAK: LEAK,
  SABOTAGE: binary(C.TAMPER, T.TAMPER.BINARY),
  SHOCK: binary(C.VIBRATION_SENSOR, T.VIBRATION_SENSOR.BINARY),
  OPENING,
  OPENING_WINDOW: OPENING,
  GARAGE_STATE: BARRIER,
  BARRIER_STATE: BARRIER,
  BATTERY: {
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    min: 0,
    max: 100,
    unit: U.PERCENT,
    throttle: true,
  },
  BATTERY_CHARGING: binary(C.BATTERY, T.BATTERY.CHARGING),
  WIND_SPEED: SPEED,
  WEATHER_WIND_SPEED: SPEED,
  RAIN_CURRENT: {
    ...decimal(C.PRECIPITATION_SENSOR, 0, 10_000),
    type: T.PRECIPITATION_SENSOR.DECIMAL,
  },
  RAIN_TOTAL: {
    ...decimal(C.PRECIPITATION_SENSOR, 0, 100_000),
    type: T.PRECIPITATION_SENSOR.DECIMAL,
  },
  DISTANCE: decimal(C.DISTANCE_SENSOR, 0, 1_000_000),
  DEPTH: { ...decimal(C.LEVEL_SENSOR, 0, 100_000), type: T.LEVEL_SENSOR.LIQUID_DEPTH },
  // Jeedom: 0 = off, 1 = heating.
  THERMOSTAT_STATE: binary(C.THERMOSTAT, T.THERMOSTAT.OPERATING_STATE, {
    max: 2,
    convert: (b) => (b ? THERMOSTAT_OPERATING_STATE.HEATING : THERMOSTAT_OPERATING_STATE.IDLE),
  }),
  THERMOSTAT_STATE_NAME: TEXT,
  WEATHER_CONDITION: TEXT,
};

/** Electrical measurements: what they are follows their unit when it says. */
const ELECTRIC = {
  POWER: 'power',
  CONSUMPTION: 'energy',
  VOLTAGE: 'voltage',
  PRODUCTION: 'production',
  DAILY_CONSUMPTION: 'daily',
};

const KIND_BY_UNIT = {
  [U.WATT]: 'power',
  [U.KILOWATT]: 'power',
  [U.WATT_HOUR]: 'energy',
  [U.KILOWATT_HOUR]: 'energy',
  [U.MEGAWATT_HOUR]: 'energy',
  [U.VOLT]: 'voltage',
  [U.AMPERE]: 'current',
  [U.MILLI_AMPERE]: 'current',
};

/**
 * Category and type of an electrical measurement. Those of a device that
 * switches something (a plug, a light) are `switch` features, like the
 * core's Zigbee2MQTT mapping; a meter's are `energy-sensor` ones, its
 * cumulative consumption an `index`.
 */
export function electricSpec(genericType, unitText, hasSwitch) {
  const unit = unitOf(unitText);
  const declared = ELECTRIC[genericType];
  const byUnit = KIND_BY_UNIT[unit];
  if (declared === 'production') {
    return byUnit === 'energy'
      ? {
          category: C.ENERGY_PRODUCTION_SENSOR,
          type: T.ENERGY_PRODUCTION_SENSOR.INDEX,
          unit,
          min: 0,
          max: 1e12,
        }
      : {
          category: C.ENERGY_PRODUCTION_SENSOR,
          type: T.ENERGY_PRODUCTION_SENSOR.POWER,
          unit: unit ?? U.WATT,
          min: 0,
          max: 1e9,
        };
  }
  if (declared === 'daily') {
    return {
      category: C.ENERGY_SENSOR,
      type: T.ENERGY_SENSOR.ENERGY,
      unit: unit ?? U.KILOWATT_HOUR,
      min: 0,
      max: 1e9,
    };
  }
  const kind = byUnit ?? declared;
  const defaults = {
    power: { unit: U.WATT, min: hasSwitch ? 0 : -1e9, max: 1e9 },
    energy: { unit: U.KILOWATT_HOUR, min: 0, max: 1e12 },
    voltage: { unit: U.VOLT, min: 0, max: 100_000 },
    current: { unit: U.AMPERE, min: 0, max: 100_000 },
  }[kind];
  const type = hasSwitch
    ? { power: T.SWITCH.POWER, energy: T.SWITCH.ENERGY, voltage: T.SWITCH.VOLTAGE }[kind]
    : {
        power: T.ENERGY_SENSOR.POWER,
        energy: T.ENERGY_SENSOR.INDEX,
        voltage: T.ENERGY_SENSOR.VOLTAGE,
      }[kind];
  return {
    category: hasSwitch ? C.SWITCH : C.ENERGY_SENSOR,
    type: type ?? (hasSwitch ? T.SWITCH.CURRENT : T.ENERGY_SENSOR.CURRENT),
    ...defaults,
    unit: unit ?? defaults.unit,
  };
}

// --- Actuators -----------------------------------------------------------------

/** Binary actuators: one state info, on / off (/ toggle) actions. */
const SWITCHES = [
  { states: ['ENERGY_STATE'], on: 'ENERGY_ON', off: 'ENERGY_OFF' },
  { states: ['SWITCH_STATE'], on: 'SWITCH_ON', off: 'SWITCH_OFF' },
  { states: ['HEATING_STATE'], on: 'HEATING_ON', off: 'HEATING_OFF' },
  { states: ['FAN_STATE'], on: 'FAN_ON', off: 'FAN_OFF' },
  { states: ['VALVE_STATE'], on: 'VALVE_ON', off: 'VALVE_OFF' },
  { states: ['FAUCET_STATE'], on: 'FAUCET_ON', off: 'FAUCET_OFF' },
  { states: ['IRRIG_STATE'], on: 'IRRIG_ON', off: 'IRRIG_OFF' },
  { states: ['ALARM_ENABLE_STATE'], on: 'ALARM_ARMED', off: 'ALARM_RELEASED' },
].map((family) => ({ ...family, category: C.SWITCH, type: T.SWITCH.BINARY }));

const OTHER_BINARIES = [
  {
    states: ['LIGHT_STATE_BOOL', 'LIGHT_STATE'],
    on: 'LIGHT_ON',
    off: 'LIGHT_OFF',
    toggle: 'LIGHT_TOGGLE',
    category: C.LIGHT,
    type: T.LIGHT.BINARY,
  },
  {
    states: ['SIREN_STATE'],
    on: 'SIREN_ON',
    off: 'SIREN_OFF',
    category: C.SIREN,
    type: T.SIREN.BINARY,
  },
  // Jeedom: 1 = locked; LOCK_CLOSE locks, LOCK_OPEN unlocks. Gladys: 1 = locked.
  {
    states: ['LOCK_STATE'],
    on: 'LOCK_CLOSE',
    off: 'LOCK_OPEN',
    category: C.LOCK,
    type: T.LOCK.BINARY,
  },
  {
    states: ['THERMOSTAT_LOCK'],
    on: 'THERMOSTAT_SET_LOCK',
    off: 'THERMOSTAT_SET_UNLOCK',
    category: C.CHILD_LOCK,
    type: T.CHILD_LOCK.BINARY,
  },
];

/**
 * What Gladys is told of a mode option, in the form its core accepts: it refuses the
 * WHOLE publication for one option with a blank label, a blank or padded value or a
 * value seen twice, and the text comes from the Jeedom configuration. So an option
 * without a usable value is left out (undefined), and one without a label is labelled
 * with its value.
 */
function publishedOption(entry) {
  const value = cut(entry.value, 100);
  if (value === '' || value !== value.trim()) {
    return undefined;
  }
  return { value, label: cut(entry.label, 100).trim() || value };
}

/** Mode lists: the info shows the name of the action of the current mode. */
const MODES = [
  { info: 'THERMOSTAT_MODE', action: 'THERMOSTAT_SET_MODE' },
  { info: 'MODE_STATE', action: 'MODE_SET_STATE' },
  { info: 'ALARM_MODE', action: 'ALARM_SET_MODE' },
  { info: undefined, action: 'LIGHT_MODE' },
];

/** Never a feature: technical commands, or used for the transport badge. */
const IGNORED = new Set(['DONT', 'ONLINE']);

// --- The equipment ---------------------------------------------------------------

/**
 * Pairs info commands with the actions that change them: by the link of each
 * action (`value`), else in order; the actions left make groups of their own.
 * @returns {Array<{ state?: object, [role: string]: object }>}
 */
export function pairActions(states, actionsByRole) {
  const groups = states.map((state) => ({ state }));
  const leftovers = {};
  for (const [role, actions] of Object.entries(actionsByRole)) {
    const free = [];
    for (const action of actions) {
      const group = groups.find((g) => g.state.id === action.link);
      if (group && !group[role]) {
        group[role] = action;
      } else {
        free.push(action);
      }
    }
    for (const group of groups) {
      if (!group[role] && free.length > 0) {
        group[role] = free.shift();
      }
    }
    leftovers[role] = free;
  }
  const count = Math.max(0, ...Object.values(leftovers).map((list) => list.length));
  for (let i = 0; i < count; i += 1) {
    const group = {};
    for (const [role, list] of Object.entries(leftovers)) {
      if (list[i]) {
        group[role] = list[i];
      }
    }
    groups.push(group);
  }
  return groups;
}

class EquipmentMapper {
  constructor(eq) {
    this.eq = eq;
    this.used = new Set();
    this.features = [];
    this.readers = [];
    this.writers = {};
    this.throttled = new Set();
    this.optimistic = new Set();
    this.online = undefined;
  }

  infos(types) {
    return this.eq.cmds.filter((c) => c.type === 'info' && types.includes(c.genericType));
  }

  actions(types) {
    return this.eq.cmds.filter((c) => c.type === 'action' && types.includes(c.genericType));
  }

  /**
   * One feature.
   * @param {string} key `<anchor command id>-<role>`: part of the external id, never change it
   * @param {object} spec category, type, unit, min, max…
   * @param {{ state?: object, read?: Function, write?: Function, text?: boolean, throttle?: boolean }} io
   */
  add(key, name, spec, { state, read, write, text = false, throttle = false } = {}) {
    if (this.features.some((f) => f.key === key)) {
      return;
    }
    const feature = {
      key,
      name: cut(name, 100),
      category: spec.category,
      type: spec.type,
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      read_only: !write,
      // Feedback = a command whose result Jeedom reports back.
      has_feedback: Boolean(write && state && read),
      keep_history: !text,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    if (spec.supported_options) {
      feature.supported_options = spec.supported_options;
    }
    this.features.push(feature);
    if (state && read) {
      this.used.add(state.id);
      this.readers.push({ cmdId: state.id, key, read });
    }
    if (write) {
      this.writers[key] = { write, text };
      if (!state) {
        this.optimistic.add(key);
      }
    }
    if (throttle) {
      this.throttled.add(key);
    }
  }

  binaryReader(state, convert = (b) => b) {
    const invert = state.invert && state.subType === 'binary';
    return (raw) => {
      const b = toBinary(raw);
      if (b === undefined) {
        return null;
      }
      return { state: convert(invert ? 1 - b : b) };
    };
  }

  /** On/off actuators; returns the groups (their numeric states are levels). */
  binaryFamily({ states, on, off, toggle, category, type }) {
    const all = this.infos(states);
    let candidates = all.filter((c) => c.subType === 'binary');
    const derived = candidates.length === 0;
    if (derived) {
      // A dimmer: its numeric state is its level, on when above 0.
      candidates = all.filter((c) => c.subType === 'numeric');
    }
    const groups = pairActions(candidates, {
      on: this.actions([on]),
      off: this.actions([off]),
      toggle: toggle ? this.actions([toggle]) : [],
    });
    for (const g of groups) {
      if (!g.on && !g.off && !g.toggle && (!g.state || derived)) {
        continue;
      }
      const anchor = g.state ?? g.on ?? g.off ?? g.toggle;
      const name = g.state && !derived ? g.state.name : (g.on ?? g.off ?? g.toggle ?? g.state).name;
      const read = g.state ? this.binaryReader(g.state) : undefined;
      const canWrite = g.on || g.off || g.toggle;
      this.add(
        `${anchor.id}-binary`,
        name,
        { category, type, min: 0, max: 1 },
        {
          state: g.state,
          read,
          write: canWrite
            ? (value, raw = () => undefined) => {
                const wanted = Number(value) > 0 ? 1 : 0;
                const action = wanted ? g.on : g.off;
                if (action) {
                  return [exec(action)];
                }
                if (g.toggle) {
                  const current = g.state ? read(raw(g.state.id))?.state : undefined;
                  return current === wanted ? [] : [exec(g.toggle)];
                }
                throw new Error(`${anchor.name} cannot be turned ${wanted ? 'on' : 'off'}`);
              }
            : undefined,
        },
      );
    }
    return groups;
  }

  /**
   * A numeric setting: an info (its value) and a slider action (to set it).
   * @param {{ infos: string[], slider: string, suffix: string, alone: boolean, range: number[], integer?: boolean }} options
   *   `alone`: an info without a slider is still a feature (read only).
   */
  levels({ infos, slider, suffix, category, type, unit, alone, range, integer = false }) {
    const states = this.infos(infos).filter((c) => c.subType === 'numeric');
    const groups = pairActions(states, { slider: this.actions([slider]) });
    for (const g of groups) {
      if (!g.slider && !(alone && g.state)) {
        continue;
      }
      const anchor = g.state ?? g.slider;
      const min = g.slider?.min ?? g.state?.min ?? range[0];
      const max = g.slider?.max ?? g.state?.max ?? range[1];
      // The info names the value ("Setpoint"), unless it already names the
      // on/off of a dimmer: then the slider does ("Intensity").
      const named = g.state && !this.used.has(g.state.id) ? g.state : (g.slider ?? g.state);
      this.add(
        `${anchor.id}-${suffix}`,
        named.name,
        {
          category,
          type,
          min,
          max,
          unit: unit === null ? undefined : (unit ?? unitOf(anchor.unit)),
        },
        {
          state: g.state,
          read: g.state
            ? (raw) => {
                const n = toNumber(raw);
                return n === undefined ? null : { state: n };
              }
            : undefined,
          write: g.slider
            ? (value) => {
                const n = toNumber(value);
                if (n === undefined) {
                  throw new Error(`${g.slider.name}: ${value} is not a number`);
                }
                const v = clamp(
                  integer ? Math.round(n) : n,
                  Math.min(min, max),
                  Math.max(min, max),
                );
                return [exec(g.slider, { slider: v })];
              }
            : undefined,
        },
      );
    }
  }

  lights() {
    const [light] = OTHER_BINARIES;
    this.binaryFamily(light);
    this.levels({
      infos: ['LIGHT_BRIGHTNESS', 'LIGHT_STATE'],
      slider: 'LIGHT_SLIDER',
      suffix: 'brightness',
      category: C.LIGHT,
      type: T.LIGHT.BRIGHTNESS,
      alone: false,
      range: [0, 100],
      integer: true,
    });
    for (const info of this.infos(['LIGHT_BRIGHTNESS'])) {
      // A brightness without slider is still worth reading.
      if (!this.used.has(info.id) && info.subType === 'numeric') {
        this.add(
          `${info.id}-brightness`,
          info.name,
          { category: C.LIGHT, type: T.LIGHT.BRIGHTNESS, min: info.min ?? 0, max: info.max ?? 100 },
          { state: info, read: (raw) => numberState(raw) },
        );
      }
    }
    const colors = pairActions(this.infos(['LIGHT_COLOR']), {
      set: this.actions(['LIGHT_SET_COLOR']),
    });
    for (const g of colors) {
      const anchor = g.state ?? g.set;
      this.add(
        `${anchor.id}-color`,
        anchor.name,
        { category: C.LIGHT, type: T.LIGHT.COLOR, min: 0, max: 0xffffff },
        {
          state: g.state,
          read: g.state
            ? (raw) => {
                const n = colorToInt(raw);
                return n === undefined ? null : { state: n };
              }
            : undefined,
          write: g.set ? (value) => [exec(g.set, { color: intToColor(value) })] : undefined,
        },
      );
    }
    this.levels({
      infos: ['LIGHT_COLOR_TEMP'],
      slider: 'LIGHT_SET_COLOR_TEMP',
      suffix: 'temperature',
      category: C.LIGHT,
      type: T.LIGHT.TEMPERATURE,
      unit: null,
      alone: true,
      range: [153, 500],
      integer: true,
    });
  }

  switches() {
    for (const family of [...SWITCHES, ...OTHER_BINARIES.slice(1)]) {
      this.binaryFamily(family);
    }
    this.levels({
      infos: ['ENERGY_STATE'],
      slider: 'ENERGY_SLIDER',
      suffix: 'dimmer',
      category: C.SWITCH,
      type: T.SWITCH.DIMMER,
      unit: null,
      alone: false,
      range: [0, 100],
      integer: true,
    });
  }

  /** Shutters and motorized windows: position, open / close / stop. */
  covers(prefix) {
    const groups = pairActions(this.infos([`${prefix}_STATE`]), {
      up: this.actions([`${prefix}_UP`]),
      down: this.actions([`${prefix}_DOWN`]),
      stop: this.actions([`${prefix}_STOP`]),
      slider: this.actions([`${prefix}_SLIDER`]),
    });
    for (const g of groups) {
      const numeric = g.state?.subType === 'numeric' ? g.state : undefined;
      const binaryState = g.state?.subType === 'binary' ? g.state : undefined;
      const min = g.slider?.min ?? numeric?.min ?? 0;
      const max = g.slider?.max ?? numeric?.max ?? 100;
      if (numeric || g.slider) {
        const anchor = numeric ?? g.slider;
        this.add(
          `${anchor.id}-position`,
          (g.slider ?? numeric).name,
          { category: C.SHUTTER, type: T.SHUTTER.POSITION, min, max, unit: U.PERCENT },
          {
            state: numeric,
            read: numeric ? (raw) => numberState(raw) : undefined,
            write: g.slider
              ? (value) => {
                  const n = toNumber(value);
                  if (n === undefined) {
                    throw new Error(`${g.slider.name}: ${value} is not a number`);
                  }
                  return [exec(g.slider, { slider: clamp(Math.round(n), min, max) })];
                }
              : undefined,
          },
        );
      }
      if (g.up || g.down || g.stop || binaryState) {
        const anchor = binaryState ?? g.up ?? g.down ?? g.stop;
        this.add(
          `${anchor.id}-state`,
          (binaryState ?? anchor).name,
          { category: C.SHUTTER, type: T.SHUTTER.STATE, min: -1, max: 1 },
          {
            state: binaryState,
            // Jeedom: 0 = closed, 1 = open.
            read: binaryState
              ? this.binaryReader(binaryState, (b) => (b ? COVER_STATE.OPEN : COVER_STATE.CLOSE))
              : undefined,
            write:
              g.up || g.down || g.stop || g.slider
                ? (value) => coverCommand(g, Number(value), min, max)
                : undefined,
          },
        );
      }
    }
  }

  /** Gates and garage doors: open / close (/ toggle) buttons. */
  gates() {
    const groups = pairActions([], {
      open: this.actions(['GB_OPEN']),
      close: this.actions(['GB_CLOSE']),
      toggle: this.actions(['GB_TOGGLE']),
    });
    const [state] = this.infos(['GARAGE_STATE', 'BARRIER_STATE']);
    for (const g of groups) {
      const anchor = g.open ?? g.close ?? g.toggle;
      this.add(
        `${anchor.id}-state`,
        anchor.name,
        { category: C.SHUTTER, type: T.SHUTTER.STATE, min: -1, max: 1 },
        {
          write: (value, raw = () => undefined) => {
            const wanted = Number(value);
            if (wanted === COVER_STATE.STOP) {
              throw new Error(`${anchor.name} cannot be stopped`);
            }
            const action = wanted > 0 ? g.open : g.close;
            if (action) {
              return [exec(action)];
            }
            if (!g.toggle) {
              throw new Error(`${anchor.name} cannot be ${wanted > 0 ? 'opened' : 'closed'}`);
            }
            // A toggle reverses the movement: only when the gate is not already there.
            const current = state ? toNumber(raw(state.id)) : undefined;
            if (current !== undefined && (current === 0) === wanted < 0) {
              return [];
            }
            return [exec(g.toggle)];
          },
        },
      );
    }
  }

  thermostats() {
    this.levels({
      infos: ['THERMOSTAT_SETPOINT'],
      slider: 'THERMOSTAT_SET_SETPOINT',
      suffix: 'setpoint',
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.TARGET_TEMPERATURE,
      alone: true,
      range: [5, 30],
    });
    for (const feature of this.features) {
      if (feature.type === T.THERMOSTAT.TARGET_TEMPERATURE && !feature.unit) {
        feature.unit = U.CELSIUS;
      }
    }
  }

  /** Mode lists, as a text select whose options are the mode actions. */
  modes() {
    for (const { info, action } of MODES) {
      const actions = this.actions([action]);
      if (actions.length === 0) {
        continue;
      }
      const options = [];
      for (const a of actions) {
        const entries =
          a.subType === 'select' && a.listValue.length > 0
            ? a.listValue.map((o) => ({ ...o, cmd: a, select: true }))
            : [{ value: a.name, label: a.name, cmd: a, select: false }];
        for (const entry of entries) {
          const shown = publishedOption(entry);
          if (
            options.length < LIMITS.options &&
            shown &&
            !options.some((o) => o.value === entry.value || o.shown.value === shown.value)
          ) {
            options.push({ ...entry, shown });
          }
        }
      }
      const [state] = info ? this.infos([info]) : [];
      const find = (text) =>
        options.find((o) => o.value === text) ?? options.find((o) => o.label === text);
      this.add(
        `${(state ?? actions[0]).id}-mode`,
        (state ?? actions[0]).name,
        {
          category: C.TEXT,
          type: T.TEXT.SELECT,
          min: 0,
          max: 0,
          supported_options: options.map((o, i) => ({ ...o.shown, sort_order: i })),
        },
        {
          state,
          text: true,
          read: state
            ? (raw) => {
                const text = String(raw ?? '').trim();
                return text === '' ? null : { text: cut(find(text)?.value ?? text) };
              }
            : undefined,
          write: (value) => {
            const option = find(String(value ?? '').trim());
            if (!option) {
              throw new Error(`${value} is not a mode of ${this.eq.name}`);
            }
            return [exec(option.cmd, option.select ? { select: option.value } : {})];
          },
        },
      );
    }
  }

  /** Info commands with a sensor generic type. */
  sensors() {
    const hasSwitch = this.features.some((f) => f.category === C.SWITCH || f.category === C.LIGHT);
    for (const cmd of this.eq.cmds) {
      if (cmd.type !== 'info' || this.used.has(cmd.id)) {
        continue;
      }
      if (cmd.genericType === 'ONLINE') {
        this.online ??= cmd.id;
        continue;
      }
      let spec = SENSORS[cmd.genericType];
      if (!spec && ELECTRIC[cmd.genericType] && cmd.subType === 'numeric') {
        spec = { ...electricSpec(cmd.genericType, cmd.unit, hasSwitch), throttle: true };
      }
      if (!spec) {
        continue;
      }
      if (spec.text) {
        this.text(cmd, `${cmd.id}-text`);
        continue;
      }
      if (cmd.subType === 'binary' && spec.binaryVariant) {
        spec = spec.binaryVariant;
      }
      if (
        cmd.subType === 'string' ||
        (spec.binary && !['binary', 'numeric'].includes(cmd.subType))
      ) {
        continue;
      }
      const read = spec.binary
        ? spec.raw
          ? (raw) => {
              const n = toNumber(raw);
              return n === undefined ? null : { state: spec.convert(n) };
            }
          : this.binaryReader(cmd, spec.convert)
        : (raw) => numberState(raw);
      this.add(
        `${cmd.id}-sensor`,
        cmd.name,
        {
          ...spec,
          unit: spec.binary ? undefined : (unitOf(cmd.unit) ?? spec.unit),
          min: spec.binary ? spec.min : (cmd.min ?? spec.min),
          max: spec.binary ? spec.max : (cmd.max ?? spec.max),
        },
        { state: cmd, read, throttle: Boolean(spec.throttle) },
      );
    }
  }

  text(cmd, key) {
    this.add(
      key,
      cmd.name,
      { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 },
      {
        state: cmd,
        text: true,
        read: (raw) => (raw === null || raw === undefined ? null : { text: cut(raw) }),
      },
    );
  }

  /** The visible info commands nothing else took: a value or a text. */
  others() {
    for (const cmd of this.eq.cmds) {
      if (
        cmd.type !== 'info' ||
        !cmd.visible ||
        this.used.has(cmd.id) ||
        IGNORED.has(cmd.genericType)
      ) {
        continue;
      }
      if (cmd.subType === 'string') {
        this.text(cmd, `${cmd.id}-text`);
      } else if (cmd.subType === 'binary') {
        this.add(
          `${cmd.id}-value`,
          cmd.name,
          { category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: 0, max: 1 },
          { state: cmd, read: this.binaryReader(cmd) },
        );
      } else if (cmd.subType === 'numeric') {
        this.add(
          `${cmd.id}-value`,
          cmd.name,
          {
            category: C.UNKNOWN,
            type: T.UNKNOWN.UNKNOWN,
            unit: unitOf(cmd.unit),
            min: cmd.min ?? -1e12,
            max: cmd.max ?? 1e12,
          },
          { state: cmd, read: (raw) => numberState(raw), throttle: true },
        );
      }
    }
  }

  map() {
    this.lights();
    this.switches();
    this.covers('FLAP');
    this.covers('WINDOW');
    this.gates();
    this.thermostats();
    this.modes();
    this.sensors();
    this.others();
    return {
      features: this.features,
      readers: this.readers,
      writers: this.writers,
      throttled: this.throttled,
      optimistic: this.optimistic,
      online: this.online,
    };
  }
}

const numberState = (raw) => {
  const n = toNumber(raw);
  return n === undefined ? null : { state: n };
};

/** COVER_STATE -> the up / down / stop action, or the slider at its ends. */
function coverCommand(g, value, min, max) {
  if (value === COVER_STATE.OPEN) {
    if (g.up) {
      return [exec(g.up)];
    }
    if (g.slider) {
      return [exec(g.slider, { slider: max })];
    }
  } else if (value === COVER_STATE.CLOSE) {
    if (g.down) {
      return [exec(g.down)];
    }
    if (g.slider) {
      return [exec(g.slider, { slider: min })];
    }
  } else if (value === COVER_STATE.STOP && g.stop) {
    return [exec(g.stop)];
  }
  const what = { 1: 'opened', '-1': 'closed', 0: 'stopped' }[value] ?? `set to ${value}`;
  throw new Error(`this shutter cannot be ${what}`);
}

/** One Jeedom equipment (see src/inventory.js) -> features, readers, writers. */
export function mapEquipment(eq) {
  return new EquipmentMapper(eq).map();
}
