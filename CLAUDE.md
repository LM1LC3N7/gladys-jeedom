# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency. It reads the inventory of the user's Jeedom box through
the Jeedom JSON-RPC API, turns every equipment into a Gladys device, follows
the Jeedom changes and sends the Gladys commands back. Unofficial, not
affiliated with Jeedom.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/mapping.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          JeedomApp: connection, change loop, inventory reloads,
                    states, commands, transports, connection test
src/jeedom.js       the only network access: JSON-RPC client, error kinds
src/inventory.js    jeeObject::all + eqLogic::all + cmd::all -> equipment (pure)
src/mapping.js      one equipment -> features, readers, writers (pure)
src/devices.js      equipment -> Gladys devices + routing tables (pure)
src/publisher.js    states within the Gladys rate limit
src/config.js       config_schema normalized (API URL)
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      Jeedom answers shaped like a real box
test/helpers/       a fake Jeedom box; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `jeedom:<eqLogic id>`, feature =
  `<command id>-<role>` (`binary`, `brightness`, `color`, `temperature`,
  `dimmer`, `position`, `state`, `setpoint`, `mode`, `sensor`, `text`,
  `value`). Never change how they are built.
- The manifest keys (`test_connection`, the config keys) are frozen: users store them.
- Value conventions: the Jeedom side follows
  https://doc.jeedom.com/dev/fr_FR/cmd_value, the Gladys side the enums of
  `server/utils/constants.js` (copied in `src/mapping.js`, the SDK does not
  export them). They differ (door sensors, covers): convert in the readers.
- Never send a unit Gladys does not know (`unitOf` returns undefined): the
  whole device list would be refused.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Never log or put in a status message the API key (it travels in the request
  body: errors never quote the body).
- Tests never touch the network: `test/helpers/fakeJeedom.js` stands for the
  box. The real HTTP path is checked by hand against the official Jeedom Docker
  image (see TODO.md).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
