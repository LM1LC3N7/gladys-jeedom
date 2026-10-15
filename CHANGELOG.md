# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- An answer of Jeedom over the size limit (32 MB) is reported as such, instead
  of a truncated answer read as "not a Jeedom API answer".

## [0.1.1] - 2026-10-15

### Added

- Connection to a Jeedom 4 box through its JSON-RPC API (http or https, API key
  of the core or of a user; TLS verification can be turned off for a
  self-signed certificate).
- Every enabled and visible Jeedom equipment offered in Discovery, one Gladys
  device per equipment, named after its room.
- The Jeedom generic types turned into Gladys features: lights (on/off,
  brightness, color, color temperature), plugs and switches (with their power,
  energy and voltage), shutters, gates, locks, sirens, thermostats (setpoint,
  temperatures, heating state, mode list), mode and alarm lists, ~40 sensor
  types, energy meters; the other visible info commands as values or texts.
- The states follow Jeedom within seconds (`event::changes`), the values missed
  while Jeedom was unreachable come back at the reconnection.
- Gladys commands run the Jeedom actions (`cmd::execCmd`).
- Transport badges: unreachable when Jeedom is, or when the "Online" command of
  an equipment says so.
- "Test the connection" button: Jeedom version, equipments, commands and
  devices offered.
- Sensor readings throttled to a configurable interval, all states within the
  Gladys rate limit.

[Unreleased]: https://github.com/LM1LC3N7/gladys-jeedom/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-jeedom/releases/tag/v0.1.1
