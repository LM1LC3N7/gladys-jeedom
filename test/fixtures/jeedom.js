// -----------------------------------------------------------------------------
// Answers of a Jeedom 4.4 box to jeeObject::all, eqLogic::all and cmd::all,
// shaped like the real ones (utils::o2a): ids and flags as strings, empty
// configurations as [], current values of the info commands in currentValue.
// -----------------------------------------------------------------------------

export const VERSION = '4.4.19';

export const OBJECTS = [
  { id: '1', name: 'Salon', father_id: null, isVisible: '1', position: '1' },
  { id: '2', name: 'Cuisine', father_id: null, isVisible: '1', position: '2' },
  { id: '3', name: 'Garage', father_id: null, isVisible: '0', position: '3' },
];

const eq = (id, name, objectId, plugin, extra = {}) => ({
  id: String(id),
  name,
  logicalId: '',
  generic_type: null,
  object_id: objectId === null ? null : String(objectId),
  eqType_name: plugin,
  eqReal_id: null,
  isVisible: '1',
  isEnable: '1',
  configuration: { createtime: '2024-01-01 10:00:00' },
  timeout: null,
  category: { light: '0', heating: '0' },
  display: [],
  order: '1',
  comment: '',
  tags: '',
  status: { lastCommunication: '2026-10-15 10:00:00' },
  cache: [],
  ...extra,
});

export const EQLOGICS = [
  eq(10, 'Lampe', 1, 'zwavejs'),
  eq(11, 'Ampoule couleur', 1, 'zigbee'),
  eq(12, 'Prise TV', 1, 'zwavejs'),
  eq(13, 'Volet', 1, 'zwavejs'),
  eq(14, "Porte d'entrée", null, 'zigbee'),
  eq(15, 'Thermostat', 2, 'thermostat'),
  eq(16, 'Capteur', 1, 'zigbee'),
  eq(17, 'Serrure', 3, 'zwavejs'),
  eq(18, 'Virtuel', 2, 'virtual'),
  eq(19, 'Ancien module', 1, 'zwavejs', { isEnable: '0' }),
  eq(20, 'Module caché', 1, 'zwavejs', { isVisible: '0' }),
  eq(21, 'Mode maison', null, 'mode'),
  eq(22, 'Détecteur fumée', 2, 'zigbee'),
  eq(24, 'Portail', 3, 'virtual'),
  eq(25, 'Scénarios', 2, 'virtual'),
];

const cmd = (id, eqId, type, subType, name, genericType, extra = {}) => ({
  id: String(id),
  logicalId: '',
  generic_type: genericType ?? null,
  eqType: 'zwavejs',
  name,
  order: String(id % 100),
  type,
  subType,
  eqLogic_id: String(eqId),
  isHistorized: '0',
  unite: '',
  configuration: [],
  template: { dashboard: 'default' },
  display: { invertBinary: '0' },
  value: null,
  isVisible: '1',
  alert: [],
  currentValue: null,
  ...extra,
});

const info = (id, eqId, subType, name, genericType, currentValue, extra = {}) =>
  cmd(id, eqId, 'info', subType, name, genericType, { currentValue, ...extra });

const action = (id, eqId, subType, name, genericType, link, extra = {}) =>
  cmd(id, eqId, 'action', subType, name, genericType, {
    value: link === undefined ? null : String(link),
    currentValue: null,
    ...extra,
  });

const range = (minValue, maxValue) => ({ configuration: { minValue, maxValue } });

export const CMDS = [
  // A Z-Wave dimmer: numeric state, on/off and a slider.
  info(101, 10, 'numeric', 'Etat', 'LIGHT_STATE', '42', {
    unite: '%',
    isVisible: '0',
    ...range('0', '99'),
  }),
  action(102, 10, 'other', 'On', 'LIGHT_ON', 101),
  action(103, 10, 'other', 'Off', 'LIGHT_OFF', 101),
  action(104, 10, 'slider', 'Intensité', 'LIGHT_SLIDER', 101, range('0', '99')),
  // A color bulb: binary state, brightness, color, color temperature.
  info(111, 11, 'binary', 'Etat', 'LIGHT_STATE', '1'),
  action(112, 11, 'other', 'On', 'LIGHT_ON', 111),
  action(113, 11, 'other', 'Off', 'LIGHT_OFF', 111),
  info(114, 11, 'numeric', 'Luminosité', 'LIGHT_BRIGHTNESS', '200', range('0', '254')),
  action(115, 11, 'slider', 'Luminosité', 'LIGHT_SLIDER', 114, range('0', '254')),
  info(116, 11, 'string', 'Couleur', 'LIGHT_COLOR', '#FF8000'),
  action(117, 11, 'color', 'Couleur', 'LIGHT_SET_COLOR', 116),
  info(118, 11, 'numeric', 'Température couleur', 'LIGHT_COLOR_TEMP', '370'),
  action(
    119,
    11,
    'slider',
    'Température couleur',
    'LIGHT_SET_COLOR_TEMP',
    118,
    range('153', '500'),
  ),
  // A metering plug.
  info(121, 12, 'binary', 'Etat', 'ENERGY_STATE', '1'),
  action(122, 12, 'other', 'On', 'ENERGY_ON', '#121#'),
  action(123, 12, 'other', 'Off', 'ENERGY_OFF', '#121#'),
  info(124, 12, 'numeric', 'Puissance', 'POWER', '85.3', { unite: 'W' }),
  info(125, 12, 'numeric', 'Consommation', 'CONSUMPTION', '12.5', { unite: 'kWh' }),
  info(126, 12, 'numeric', 'Tension', 'VOLTAGE', '231', { unite: 'V' }),
  // A roller shutter: numeric position (0 closed, 99 open) and buttons.
  info(131, 13, 'numeric', 'Etat', 'FLAP_STATE', '50', range('0', '99')),
  action(132, 13, 'other', 'Monter', 'FLAP_UP', 131),
  action(133, 13, 'other', 'Descendre', 'FLAP_DOWN', 131),
  action(134, 13, 'other', 'Stop', 'FLAP_STOP', 131),
  action(135, 13, 'slider', 'Position', 'FLAP_SLIDER', 131, range('0', '99')),
  // A door sensor without a room: 1 = open in Jeedom.
  info(141, 14, 'binary', 'Ouverture', 'OPENING', '1'),
  info(142, 14, 'numeric', 'Batterie', 'BATTERY', '87', { unite: '%', isVisible: '0' }),
  // The thermostat plugin: setpoint, temperature, modes as one action each.
  info(151, 15, 'numeric', 'Consigne', 'THERMOSTAT_SETPOINT', '19.5', { unite: '°C' }),
  action(152, 15, 'slider', 'Thermostat', 'THERMOSTAT_SET_SETPOINT', 151, range('7', '30')),
  info(153, 15, 'numeric', 'Température', 'THERMOSTAT_TEMPERATURE', '20.1', { unite: '°C' }),
  info(154, 15, 'string', 'Mode', 'THERMOSTAT_MODE', 'Confort'),
  action(155, 15, 'other', 'Confort', 'THERMOSTAT_SET_MODE'),
  action(156, 15, 'other', 'Eco', 'THERMOSTAT_SET_MODE'),
  action(157, 15, 'other', 'Off', 'THERMOSTAT_SET_MODE'),
  info(158, 15, 'binary', 'Etat', 'THERMOSTAT_STATE', '1'),
  info(159, 15, 'string', 'Statut', 'THERMOSTAT_STATE_NAME', 'Chauffage'),
  // A multisensor, with a decimal comma and an ONLINE command.
  info(161, 16, 'numeric', 'Température', 'TEMPERATURE', '21,5', { unite: '°C' }),
  info(162, 16, 'numeric', 'Humidité', 'HUMIDITY', '48', { unite: '%' }),
  info(163, 16, 'binary', 'Présence', 'PRESENCE', '0'),
  info(164, 16, 'numeric', 'Luminosité', 'BRIGHTNESS', '120', { unite: 'Lux' }),
  info(165, 16, 'binary', 'En ligne', 'ONLINE', '1', { isVisible: '0' }),
  // A lock: 1 = locked.
  info(171, 17, 'binary', 'Etat', 'LOCK_STATE', '1'),
  action(172, 17, 'other', 'Ouvrir', 'LOCK_OPEN', 171),
  action(173, 17, 'other', 'Fermer', 'LOCK_CLOSE', 171),
  // A virtual equipment without generic types.
  info(181, 18, 'numeric', 'Compteur eau', null, '1234', { unite: 'L' }),
  info(182, 18, 'string', 'Message', null, 'Bonjour'),
  info(183, 18, 'binary', 'Mode nuit', null, '0', { display: { invertBinary: '1' } }),
  info(184, 18, 'numeric', 'Technique', null, '3', { isVisible: '0' }),
  action(185, 18, 'other', 'Rafraîchir', null),
  info(186, 18, 'numeric', 'Ignorée', 'DONT', '5'),
  // Disabled and hidden equipment.
  info(191, 19, 'binary', 'Etat', 'ENERGY_STATE', '0'),
  info(201, 20, 'binary', 'Etat', 'ENERGY_STATE', '0'),
  // The mode plugin: one select action, the info shows the label.
  info(211, 21, 'string', 'Mode', 'MODE_STATE', 'Absent'),
  action(212, 21, 'select', 'Changer de mode', 'MODE_SET_STATE', 211, {
    configuration: { listValue: '1|Présent;2|Absent;3|Nuit' },
  }),
  // A smoke detector.
  info(221, 22, 'binary', 'Fumée', 'SMOKE', '0'),
  info(222, 22, 'binary', 'Sabotage', 'SABOTAGE', '0'),
  // A gate: one toggle, a Z-Wave barrier state (0 closed, 255 open).
  info(241, 24, 'numeric', 'Etat', 'GARAGE_STATE', '0'),
  action(242, 24, 'other', 'Ouvrir / fermer', 'GB_TOGGLE'),
  // Nothing to offer: actions without a generic type.
  action(251, 25, 'other', 'Lancer', null),
];

/** A cmd::update event of event::changes. */
export const cmdEvent = (datetime, cmdId, value) => ({
  datetime: String(datetime),
  name: 'cmd::update',
  option: {
    cmd_id: String(cmdId),
    value,
    display_value: value,
    unit: '',
    raw_unit: '',
    valueDate: '2026-10-15 10:00:00',
    collectDate: '2026-10-15 10:00:00',
  },
});

/** The three inventory answers, deep-copied (tests edit them). */
export const inventoryAnswers = () =>
  structuredClone({ objects: OBJECTS, eqLogics: EQLOGICS, cmds: CMDS });
