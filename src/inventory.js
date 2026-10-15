// -----------------------------------------------------------------------------
// The Jeedom inventory, normalized (pure).
//
// Three answers: jeeObject::all (the rooms), eqLogic::all (every equipment,
// with or without a room, enabled or not) and cmd::all (every command, with
// the current value of the info ones). jeeObject::full is not used: it leaves
// out the equipment without a room and the hidden rooms.
// -----------------------------------------------------------------------------

import { asList } from './jeedom.js';

const flag = (v) => v === true || v === 1 || v === '1';
const idOf = (v) => (v === null || v === undefined || v === '' ? undefined : String(v));
const objectOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const numberOf = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') {
    return undefined;
  }
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** The id of the info command an action command reflects: "12" or "#12#". */
export function linkedId(value) {
  const match = /^#?(\d+)#?$/.exec(String(value ?? '').trim());
  return match ? match[1] : undefined;
}

/** A `listValue` configuration: "1|Comfort;2|Eco" -> [{ value: '1', label: 'Comfort' }, …]. */
export function parseListValue(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [];
  }
  return text
    .split(';')
    .map((entry) => {
      const [value, ...rest] = entry.split('|');
      const label = rest.length > 0 ? rest.join('|') : value;
      return { value: value.trim(), label: label.trim() };
    })
    .filter((o) => o.value !== '');
}

/** One command of cmd::all. */
export function normalizeCmd(raw) {
  const configuration = objectOf(raw.configuration);
  const display = objectOf(raw.display);
  const type = raw.type === 'action' ? 'action' : 'info';
  return {
    id: String(raw.id),
    eqLogicId: idOf(raw.eqLogic_id),
    name: String(raw.name ?? '').trim() || `#${raw.id}`,
    type,
    subType: String(raw.subType ?? ''),
    genericType:
      String(raw.generic_type ?? '')
        .trim()
        .toUpperCase() || undefined,
    unit: String(raw.unite ?? '').trim() || undefined,
    link: type === 'action' ? linkedId(raw.value) : undefined,
    min: numberOf(configuration.minValue),
    max: numberOf(configuration.maxValue),
    listValue: parseListValue(configuration.listValue),
    visible: raw.isVisible === undefined ? true : flag(raw.isVisible),
    invert: flag(display.invertBinary),
    order: Number(raw.order) || 0,
    value: type === 'info' ? (raw.currentValue ?? raw.state) : undefined,
  };
}

/**
 * The equipment Gladys may offer: enabled and visible, with their commands
 * sorted like in Jeedom.
 * @returns {{ equipments: object[], skipped: { disabled: number, hidden: number }, commands: number }}
 */
export function buildInventory({ objects, eqLogics, cmds }) {
  const rooms = new Map(
    asList(objects)
      .filter((o) => o && o.id !== undefined)
      .map((o) => [String(o.id), String(o.name ?? '').trim()]),
  );
  const commands = asList(cmds)
    .filter((c) => c && c.id !== undefined)
    .map(normalizeCmd);
  const byEquipment = new Map();
  for (const cmd of commands) {
    if (!byEquipment.has(cmd.eqLogicId)) {
      byEquipment.set(cmd.eqLogicId, []);
    }
    byEquipment.get(cmd.eqLogicId).push(cmd);
  }
  const equipments = [];
  const skipped = { disabled: 0, hidden: 0 };
  for (const raw of asList(eqLogics)) {
    if (!raw || raw.id === undefined || raw.id === null) {
      continue;
    }
    if (!flag(raw.isEnable)) {
      skipped.disabled += 1;
      continue;
    }
    if (!flag(raw.isVisible)) {
      skipped.hidden += 1;
      continue;
    }
    const id = String(raw.id);
    const objectId = idOf(raw.object_id);
    equipments.push({
      id,
      name: String(raw.name ?? '').trim() || `Jeedom ${id}`,
      objectId,
      objectName: objectId ? rooms.get(objectId) || undefined : undefined,
      plugin: String(raw.eqType_name ?? '').trim() || undefined,
      cmds: (byEquipment.get(id) ?? []).sort(
        (a, b) => a.order - b.order || Number(a.id) - Number(b.id),
      ),
    });
  }
  return { equipments, skipped, commands: commands.length };
}
