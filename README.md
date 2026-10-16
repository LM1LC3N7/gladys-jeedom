# gladys-jeedom

[Gladys Assistant](https://gladysassistant.com) external integration bridging a
**Jeedom** box: every enabled and visible Jeedom equipment becomes a Gladys
device of the Discovery tab, its states follow Jeedom within seconds, and Gladys
controls it through Jeedom. Made for Jeedom users who move to Gladys at their
own pace, or run both side by side. Unofficial, not affiliated with Jeedom.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **In the Gladys store.** Install it from **Integrations**, or with **Install
> from GitHub** and `https://github.com/LM1LC3N7/gladys-jeedom`. First version,
> tested against the official Jeedom Docker image (Jeedom 4.6) with test
> equipment, not yet on many real boxes. Feedback and bug reports are welcome in
> the [GitHub issues](https://github.com/LM1LC3N7/gladys-jeedom/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (JeedomApp) ⇄ src/jeedom.js ⇄ Jeedom JSON-RPC API
                                   ├─ src/inventory.js  rooms, equipment, commands -> equipment list (pure)
                                   ├─ src/mapping.js    one equipment -> features, readers, writers (pure)
                                   ├─ src/devices.js    equipment -> Gladys devices + routing tables (pure)
                                   └─ src/publisher.js  states within 300/min, sensor throttling
```

All calls go to `http(s)://<jeedom>/core/api/jeeApi.php` (JSON-RPC 2.0, the API
key in `params.apikey`):

- **Inventory**: `jeeObject::all` (rooms), `eqLogic::all` (every equipment, with
  or without a room) and `cmd::all` (every command, with the current value of
  the info ones). Read at connection, every 10 minutes, on Scan, and when an
  equipment is enabled, disabled, shown or hidden. `jeeObject::full` is not used:
  it leaves out the equipment without a room.
- **Changes**: `event::changes(datetime)` every `poll_interval` seconds (2 by
  default). The `cmd::update` events are routed to the features; two queries
  overlap by one second (an event recorded while Jeedom answers is not lost) and
  the events already applied are skipped.
- **Commands**: `onSetValue` → the writer of the feature → `cmd::execCmd` with
  the options of the action subtype (`slider`, `color`, `select`).
- **Mapping**: by the generic type of each command (`LIGHT_STATE`, `FLAP_UP`,
  `TEMPERATURE`…), with the value conventions of
  [the Jeedom documentation](https://doc.jeedom.com/dev/fr_FR/cmd_value) on one
  side and the Gladys core enums on the other (a Jeedom door sensor says 1 for
  open, Gladys 1 for closed). One device per equipment: external ids
  `ext:<selector>:jeedom:<eqLogic id>` and `…:<command id>-<role>`, stable since
  Jeedom never renumbers.
- **Failures**: Jeedom unreachable → status message and `unreachable` transport
  badges, reconnection after 5 s, doubling up to 60 s (a refused API key: every
  5 minutes). The reconnection reads the inventory again: the values changed
  meanwhile come back with it.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/jeedom.js` holds the answers of a Jeedom 4.4 box (dimmer, color
bulb, metering plug, shutter, door sensor, thermostat plugin, mode plugin, lock,
gate, virtual commands…); `test/helpers/fakeJeedom.js` serves them with an event
log. The app tests run the real SDK wiring against the SDK's fake Gladys.

The integration was also run against the official `jeedom/jeedom` Docker image
(Jeedom 4.6.1 with MariaDB, test equipment seeded): inventory, live changes,
commands, mode list, connection test, equipment disabled, wrong key, unreachable
box.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0. Jeedom is a trademark of its owners; this project is not affiliated
with Jeedom.
