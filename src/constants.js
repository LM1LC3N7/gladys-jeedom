// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Pace of the Jeedom change loop (seconds), mirrored by the manifest. */
export const POLL_INTERVAL = { min: 1, max: 60, default: 2 };

/** Sensor throttling bounds (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 300, default: 10 };

/** The path of the JSON-RPC API on a Jeedom box. */
export const API_PATH = '/core/api/jeeApi.php';

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Size of a Jeedom answer read (bytes): the inventory of a big box is a few MB. */
  responseBytes: 32 * 1024 * 1024,
  /** Text states and names sent to Gladys. */
  text: 1000,
  /** Options of a mode list. */
  options: 50,
  /** Devices published at once (publishDiscoveredDevices). */
  devices: 2000,
  /**
   * Jeedom keeps its last 250 events only: an answer this long may have lost
   * some, the values are read again from the inventory.
   */
  eventsBeforeResync: 200,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** One JSON-RPC request (the inventory ones get `inventoryTimeout`). */
  requestTimeout: 15_000,
  inventoryTimeout: 60_000,
  /** One inventory request of the connection test (the button waits 90 s). */
  testTimeout: 25_000,
  /** The inventory is read again this often: new, renamed or removed equipment. */
  inventoryRefresh: 10 * 60_000,
  /** An equipment changed in Jeedom: wait for the burst of changes to end. */
  inventoryDebounce: 3000,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 60_000,
  /** A refused API key is retried slowly: the user has to change it. */
  authRetry: 5 * 60_000,
  /**
   * event::changes answers with the time of its answer, computed after its
   * query: an event recorded in between would be lost. The next query starts
   * this much earlier (seconds); the events already applied are skipped.
   */
  replayMargin: 1,
};
