// -----------------------------------------------------------------------------
// The Jeedom inventory -> Gladys devices and routing tables (pure).
//
// One Gladys device per Jeedom equipment (eqLogic). External ids:
//   device  ext:<selector>:jeedom:<eqLogic id>
//   feature <device>:<command id>-<role>   (src/mapping.js)
// The ids of Jeedom equipment and commands never change (they survive a
// backup restore): the external ids stay stable.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';
import { mapEquipment } from './mapping.js';

/** Equipment names repeat from room to room ("Light"): the room is part of the name. */
export const deviceName = (eq) =>
  (eq.objectName ? `${eq.name} (${eq.objectName})` : eq.name).slice(0, 100);

const paramsOf = (eq) =>
  [
    { name: 'JEEDOM_ID', value: eq.id },
    { name: 'JEEDOM_OBJECT', value: eq.objectName },
    { name: 'JEEDOM_PLUGIN', value: eq.plugin },
  ].filter((p) => p.value);

export function emptyModel() {
  return {
    devices: [],
    /** command id -> [{ featureId, read }] */
    readers: new Map(),
    /** feature id -> { write, text } */
    writers: new Map(),
    throttled: new Set(),
    optimistic: new Set(),
    /** device id -> its ONLINE command id */
    online: new Map(),
    /** equipment read, and left out because nothing maps / over the limit */
    counts: { equipments: 0, empty: 0, overflow: 0 },
  };
}

/**
 * @param {(eqLogicId: string) => { device: string, feature: (key: string) => string }} idsOf
 *   the external ids of one equipment (gladys.externalIds('jeedom', id))
 * @param {{ equipments: object[] }} inventory see src/inventory.js
 */
export function buildModel(idsOf, inventory) {
  const model = emptyModel();
  for (const eq of inventory.equipments) {
    model.counts.equipments += 1;
    const mapped = mapEquipment(eq);
    if (mapped.features.length === 0) {
      model.counts.empty += 1;
      continue;
    }
    if (model.devices.length >= LIMITS.devices) {
      model.counts.overflow += 1;
      continue;
    }
    const ids = idsOf(eq.id);
    model.devices.push({
      name: deviceName(eq),
      external_id: ids.device,
      should_poll: false,
      params: paramsOf(eq),
      features: mapped.features.map(({ key, ...feature }) => ({
        ...feature,
        external_id: ids.feature(key),
      })),
    });
    for (const { cmdId, key, read } of mapped.readers) {
      if (!model.readers.has(cmdId)) {
        model.readers.set(cmdId, []);
      }
      model.readers.get(cmdId).push({ featureId: ids.feature(key), read });
    }
    for (const [key, writer] of Object.entries(mapped.writers)) {
      model.writers.set(ids.feature(key), writer);
    }
    for (const key of mapped.throttled) {
      model.throttled.add(ids.feature(key));
    }
    for (const key of mapped.optimistic) {
      model.optimistic.add(ids.feature(key));
    }
    if (mapped.online) {
      model.online.set(ids.device, mapped.online);
    }
  }
  return model;
}
