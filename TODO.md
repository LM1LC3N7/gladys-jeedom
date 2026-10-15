# TODO — Jeedom bridge v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).

## Status

- [x] **Milestone 1 — core** (2026-10-15): JSON-RPC client, inventory
      (`jeeObject::all`, `eqLogic::all`, `cmd::all`), mapping of the Jeedom
      generic types (lights, switches, covers, gates, locks, sirens,
      thermostats, mode lists, ~40 sensor types, electrical measurements,
      generic values and texts), one device per equipment, change loop
      (`event::changes`), commands (`cmd::execCmd`), transport badges (Jeedom
      reachability, ONLINE command), connection test, reconnection, manifest,
      docs en/fr. 66 tests; run against the official `jeedom/jeedom`
      image (Jeedom 4.6.1 + MariaDB 10.11, seeded test equipment): all checks
      green.
- [ ] **Milestone 2 — real boxes**: collect `cmd::all` / `eqLogic::all` answers
      from testers (Z-Wave JS, Zigbee, Philips Hue, Thermostat, Mode, Alarme,
      Virtuel, Météo, Teleinfo, Shelly, Tuya… plugins) as fixtures; fix what
      differs. Check the 0/1 conventions on real devices (doors, locks,
      gates, binary covers), and color temperature in Kelvin.
- [ ] **Milestone 3 — more types**: multimedia (`MEDIA_*`, volume), the
      generic action buttons (`GENERIC_ACTION`, scene launchers) as buttons,
      BSO tilt (`FLAP_BSO_*`), fan speed, `HEATING_OTHER` pilot wire modes
      (Gladys `heater/pilot-wire-mode`), cameras (`CAMERA_URL` snapshot), the
      Jeedom scenarios (`scenario::all`, a scene action to run one), and the
      `actionConfirm` / access code commands (a config field?).
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, forum thread in Développement.

## Decisions

- Inventory with `eqLogic::all` + `cmd::all` + `jeeObject::all`, not
  `jeeObject::full`: the latter leaves out the equipment without a room and
  the hidden rooms. Read at connection, every 10 minutes, on Scan, and when an
  `eqLogic::update` event changes the enable/visible state of an equipment
  (it is also sent on every widget refresh: the other ones are ignored).
- Changes by short polling of `event::changes` (2 s by default), not its
  undocumented `longPolling` parameter. Jeedom keeps 250 events: an answer of
  200 or more reloads the inventory, and so does every reconnection. Queries
  overlap by 1 s (Jeedom computes the answer time after its query); the events
  already applied (same command, not newer) are skipped.
- Disabled or hidden equipment is left out. Info commands with a generic type
  are offered even when hidden (state commands often are); without a generic
  type, only the visible ones, numeric/binary as `unknown`, strings as `text`.
  `DONT` commands and action commands without a mapped generic type are left
  out.
- Device name = `<equipment> (<room>)`: equipment names repeat from room to
  room. Params `JEEDOM_ID`, `JEEDOM_OBJECT`, `JEEDOM_PLUGIN`.
- Pairing actions with their info: by the `value` link of the action (`12` or
  `#12#`), else in order; actions left alone make write-only, optimistic
  features. Several channels in one equipment work when the links are set.
- A dimmer (numeric `LIGHT_STATE` / `ENERGY_STATE`) gives an on/off feature
  derived from its level (> 0) plus a brightness / dimmer feature.
- Conversions: Jeedom door/window 1 = open → Gladys `OPENING_SENSOR_STATE`
  (OPEN 0, CLOSE 1); gate/garage state 0 = closed, 252–255 moving/open; cover
  binary 1 = open → `COVER_STATE`; `display.invertBinary` honored on binary
  infos (like the Jeedom Homebridge plugin).
- Measurements of a device that has a switch or a light are `switch`
  features (power, energy, voltage), a meter's are `energy-sensor` ones, its
  consumption an `index`; the unit decides when it contradicts the generic type.
- Mode lists (`THERMOSTAT_MODE`, `MODE_STATE`, `ALARM_MODE`, `LIGHT_MODE`) are
  `text/select` features whose options are the mode actions (or the
  `listValue` of a select action); the info is read by value or by label.
- Gladys `gladys_version >= 5.1.0` (text/select string options).
- Errors: the API answers `-32000 - code`: 2 = key refused (retried every 5
  minutes), 1 = access refused (API disabled, IP not allowed). After failed
  logins Jeedom bans the caller (HTML 404): the status says so.

## End-to-end check (manual)

Scripts outside the repository, in `~/gladys-integrations/e2e/` on the
development machine: `jeedom-e2e.sh up` (official image + MariaDB, installer
run), copy `jeedom/gladyse2e` into `/var/www/html/plugins/` and run
`jeedom/seed.php` (a virtual-like test plugin and 5 equipments), then
`run-jeedom-e2e.sh` (the app with the SDK's fake Gladys against the box).
Observed on Jeedom 4.6.1: ids, flags and `order` are numbers (strings on older
boxes, both handled), empty lists answer `"ok"`, a wrong key answers
`{ error: { code: 2 } }`.
