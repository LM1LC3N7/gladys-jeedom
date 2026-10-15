// -----------------------------------------------------------------------------
// The integration: one Jeedom box, its inventory turned into Gladys devices,
// the change loop (event::changes) feeding the states, and the commands sent
// back (cmd::execCmd). index.js only wires the SDK handlers to it.
//
// Lifecycle: start -> open (Jeedom clock, version, inventory) -> poll every
// `poll_interval` seconds -> on a failure, reconnect with a growing delay
// (the reconnection reads the inventory again: the values missed meanwhile
// come back with it). The inventory is also read again every 10 minutes and
// when an equipment is enabled, disabled, shown or hidden in Jeedom.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { LIMITS, TIMINGS } from './constants.js';
import { buildModel, emptyModel } from './devices.js';
import { T } from './i18n.js';
import { buildInventory } from './inventory.js';
import { JeedomError, createClient } from './jeedom.js';
import { toBinary } from './mapping.js';
import { StatePublisher } from './publisher.js';

const flag = (v) => v === true || v === 1 || v === '1';

export class JeedomApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'jeedom' }),
    connect = createClient,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.client = null;
    this.model = emptyModel();
    this.inventory = undefined;
    /** equipment ids of the inventory (enabled and visible) */
    this.known = new Set();
    /** ONLINE command id -> device id */
    this.onlineCmds = new Map();
    this.version = undefined;
    this.online = false;
    /** event::changes cursor: Jeedom time, in seconds with microseconds */
    this.since = undefined;
    /** command id -> time of the last event applied */
    this.lastEvent = new Map();
    /** command id -> last value read (writers compare with it) */
    this.raw = new Map();
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    this.transports = new Map();
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.failures = 0;
    this.generation = 0;
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.client = this.connect({
      url: this.config.url,
      apiKey: this.config.apiKey,
      verifyCertificate: this.config.verifyCertificate,
    });
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.publisher.start();
    await this.setStatus(false, T.connecting);
    await this.open(generation);
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.inventoryTimer);
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.publisher.stop();
    this.client?.close?.();
    this.client = null;
    this.online = false;
    this.failures = 0;
    this.since = undefined;
  }

  current(generation) {
    return generation === this.generation;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** Runs `fn` after `ms`, unless the app was restarted or stopped meanwhile. */
  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`Jeedom loop: ${err.message}`));
      }
    }, ms);
  }

  /** Connects: the Jeedom clock (cursor of the changes), its version, the inventory. */
  async open(generation) {
    const client = this.client;
    try {
      const since = Number(await client.call('datetime'));
      const version = await client.call('version');
      await this.loadInventory(generation);
      if (!this.current(generation)) {
        return;
      }
      this.since = Number.isFinite(since) ? since : undefined;
      this.version = String(version);
      this.online = true;
      this.failures = 0;
      this.logger.info(`Connected to Jeedom ${this.version} at ${this.config.origin}`);
      await this.setStatus(true, T.connected(this.version, this.model.devices.length));
      await this.publishAllTransports();
      this.schedule(generation, this.config.pollInterval * 1000, () => this.poll(generation));
      this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
    } catch (err) {
      await this.fail(generation, err);
    }
  }

  async fail(generation, err) {
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.failures += 1;
    const slow = err?.kind === 'auth' || err?.kind === 'forbidden';
    const delay = slow
      ? TIMINGS.authRetry
      : Math.min(TIMINGS.retryMax, TIMINGS.retryMin * 2 ** (this.failures - 1));
    if (err instanceof JeedomError) {
      this.logger.warn(`Jeedom: ${err.message} (retrying in ${Math.round(delay / 1000)} s)`);
    } else {
      this.logger.error('Jeedom: unexpected failure', err);
    }
    await this.setStatus(false, T.failure(err));
    await this.publishAllTransports();
    this.timers.clearTimeout(this.inventoryTimer);
    this.schedule(generation, delay, () => this.open(generation));
  }

  // --- Changes -----------------------------------------------------------------

  async poll(generation) {
    const client = this.client;
    try {
      const answer = await client.call('event::changes', { datetime: this.since ?? 0 });
      if (!this.current(generation)) {
        return;
      }
      this.applyChanges(generation, answer);
    } catch (err) {
      await this.fail(generation, err);
      return;
    }
    this.schedule(generation, this.config.pollInterval * 1000, () => this.poll(generation));
  }

  /** One answer of event::changes: { datetime, result: [{ datetime, name, option }] }. */
  applyChanges(generation, answer) {
    const datetime = Number(answer?.datetime);
    const events = answer?.result;
    if (!Number.isFinite(datetime) || !Array.isArray(events)) {
      throw new JeedomError('format', 'unexpected answer to event::changes');
    }
    const priming = this.since === undefined;
    this.since = datetime - TIMINGS.replayMargin;
    if (priming) {
      // No Jeedom clock at connection: start from now, the inventory has the values.
      return;
    }
    let reload = events.length >= LIMITS.eventsBeforeResync;
    for (const event of events) {
      const option = event?.option && typeof event.option === 'object' ? event.option : {};
      if (event?.name === 'cmd::update' && option.cmd_id !== undefined) {
        const cmdId = String(option.cmd_id);
        const at = Number(event.datetime);
        if (Number.isFinite(at)) {
          if (at <= (this.lastEvent.get(cmdId) ?? -Infinity)) {
            continue; // already applied (the queries overlap by replayMargin)
          }
          this.lastEvent.set(cmdId, at);
        }
        this.setRaw(cmdId, option.value);
      } else if (event?.name === 'eqLogic::update' && option.eqLogic_id !== undefined) {
        // Sent on every widget refresh: only an enable / visibility change matters.
        const wanted = flag(option.enable) && flag(option.visible);
        if (wanted !== this.known.has(String(option.eqLogic_id))) {
          reload = true;
        }
      }
    }
    if (reload) {
      this.scheduleInventory(generation, TIMINGS.inventoryDebounce);
    }
  }

  /** Keeps the value of a command and routes it to its features. */
  setRaw(cmdId, raw) {
    this.raw.set(cmdId, raw);
    for (const { featureId, read } of this.model.readers.get(cmdId) ?? []) {
      let value;
      try {
        value = read(raw);
      } catch (err) {
        this.warnOnce(`read:${featureId}`, `${featureId}: ${err.message}`);
        continue;
      }
      if (value) {
        this.record(featureId, value);
      }
    }
    const deviceId = this.onlineCmds.get(cmdId);
    if (deviceId) {
      this.publishTransport(deviceId).catch((err) =>
        this.logger.warn(`Transport badge failed: ${err.message}`),
      );
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  // --- Inventory -----------------------------------------------------------------

  idsOf(eqLogicId) {
    return this.gladys.externalIds('jeedom', eqLogicId);
  }

  async readInventory(client, timeout = TIMINGS.inventoryTimeout) {
    const objects = await client.call('jeeObject::all', {}, { timeout });
    const eqLogics = await client.call('eqLogic::all', {}, { timeout });
    const cmds = await client.call('cmd::all', {}, { timeout });
    return buildInventory({ objects, eqLogics, cmds });
  }

  /** Reads the rooms, equipment and commands; publishes the devices and the values. */
  async loadInventory(generation, { force = false } = {}) {
    const inventory = await this.readInventory(this.client);
    if (!this.current(generation)) {
      return;
    }
    const model = buildModel((id) => this.idsOf(id), inventory);
    this.inventory = inventory;
    this.model = model;
    this.known = new Set(inventory.equipments.map((eq) => eq.id));
    this.onlineCmds = new Map([...model.online].map(([deviceId, cmdId]) => [cmdId, deviceId]));
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: model.throttled,
    });
    for (const eq of inventory.equipments) {
      for (const cmd of eq.cmds) {
        if (cmd.type === 'info' && cmd.value !== undefined && cmd.value !== null) {
          this.setRaw(cmd.id, cmd.value);
        }
      }
    }
    const json = JSON.stringify(model.devices);
    if (force || json !== this.publishedDevices) {
      try {
        await this.gladys.publishDiscoveredDevices(model.devices);
        this.publishedDevices = json;
        this.logger.info(
          `${model.devices.length} devices offered in Discovery (${inventory.equipments.length} enabled and visible equipments)`,
        );
      } catch (err) {
        this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
      }
    }
  }

  scheduleInventory(generation, ms) {
    this.timers.clearTimeout(this.inventoryTimer);
    this.inventoryTimer = this.timers.setTimeout(() => {
      this.inventoryTimer = undefined;
      if (!this.current(generation) || !this.online) {
        return; // the reconnection reads it anyway
      }
      this.loadInventory(generation)
        .then(async () => {
          if (this.current(generation) && this.online) {
            await this.setStatus(true, T.connected(this.version, this.model.devices.length));
            await this.publishAllTransports();
          }
        })
        .catch((err) => this.logger.warn(`Reading the Jeedom inventory failed: ${err.message}`))
        .finally(() => {
          if (this.current(generation) && !this.inventoryTimer) {
            this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
          }
        });
    }, ms);
  }

  /** The Scan button of the Discovery tab. */
  async rescan() {
    if (!this.online || !this.client) {
      await this.gladys.publishDiscoveredDevices(this.model.devices);
      return;
    }
    await this.loadInventory(this.generation, { force: true });
  }

  // --- Transport badges ----------------------------------------------------------

  transportOf(deviceId) {
    if (!this.online) {
      return DEVICE_TRANSPORTS.UNREACHABLE;
    }
    const cmdId = this.model.online.get(deviceId);
    if (cmdId !== undefined && toBinary(this.raw.get(cmdId)) === 0) {
      return DEVICE_TRANSPORTS.UNREACHABLE;
    }
    return DEVICE_TRANSPORTS.LOCAL;
  }

  async publishTransport(deviceId) {
    if (!this.createdDevices().has(deviceId)) {
      return;
    }
    const transport = this.transportOf(deviceId);
    if (this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys.publishTransports([{ external_id: deviceId, transport }]);
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      const transport = this.transportOf(deviceId);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user -------------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands ------------------------------------------------------------------

  async setValue(device, feature, value) {
    const client = this.client;
    if (!client || !this.online) {
      throw new Error('Jeedom is not connected');
    }
    const writer = this.model.writers.get(feature.external_id);
    if (!writer) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    const calls = writer.write(value, (cmdId) => this.raw.get(cmdId));
    for (const { id, options } of calls) {
      await client.call('cmd::execCmd', { id, options });
    }
    this.logger.debug(`${calls.length} Jeedom command(s) run for ${feature.external_id}`);
    if (this.model.optimistic.has(feature.external_id)) {
      this.record(
        feature.external_id,
        writer.text ? { text: String(value) } : { state: Number(value) },
      );
    }
  }

  // --- Configuration screen button ---------------------------------------------------

  /** Reads the version and the inventory with the saved configuration, and counts. */
  async testConnection() {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    const client = this.connect({
      url: config.url,
      apiKey: config.apiKey,
      verifyCertificate: config.verifyCertificate,
    });
    try {
      const version = await client.call('version');
      const inventory = await this.readInventory(client, TIMINGS.testTimeout);
      const model = buildModel((id) => this.idsOf(id), inventory);
      return T.test.ok({
        version: String(version),
        devices: model.devices.length,
        equipments: inventory.equipments.length,
        commands: inventory.commands,
        disabled: inventory.skipped.disabled,
        hidden: inventory.skipped.hidden,
        empty: model.counts.empty,
      });
    } catch (err) {
      if (!(err instanceof JeedomError)) {
        this.logger.error('Connection test failed', err);
      }
      return T.failure(err);
    } finally {
      client.close?.();
    }
  }
}
