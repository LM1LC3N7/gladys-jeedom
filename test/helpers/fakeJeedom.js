// A fake Jeedom box behind the client of src/jeedom.js: the inventory of the
// fixtures, an event log for event::changes, the commands run, failures.

import { JeedomError } from '../../src/jeedom.js';
import { VERSION, cmdEvent, inventoryAnswers } from '../fixtures/jeedom.js';

export const API_KEY = 'k'.repeat(32);

export function fakeJeedom({ apiKey = API_KEY, version = VERSION } = {}) {
  const box = {
    ...inventoryAnswers(),
    version,
    /** Jeedom time (seconds, microsecond precision) */
    clock: 1_760_000_000,
    /** the event table: event::changes answers the ones since its datetime */
    events: [],
    /** every call, without the API key */
    calls: [],
    /** cmd::execCmd params */
    executed: [],
    /** an error every call throws (a JeedomError) */
    fail: undefined,
    /** command id -> error thrown by cmd::execCmd */
    execErrors: {},
    clients: [],
  };

  /** A value changes in Jeedom: its cmd::update event, and the inventory follows. */
  box.emit = (cmdId, value) => {
    box.clock += 0.25;
    box.events.push(cmdEvent(box.clock, cmdId, value));
    const cmd = box.cmds.find((c) => c.id === String(cmdId));
    if (cmd) {
      cmd.currentValue = value;
    }
  };

  box.callsOf = (method) => box.calls.filter((c) => c.method === method);

  const answer = (method, params) => {
    switch (method) {
      case 'datetime':
        return box.clock;
      case 'version':
        return box.version;
      case 'jeeObject::all':
        return structuredClone(box.objects);
      case 'eqLogic::all':
        return box.eqLogics.length > 0 ? structuredClone(box.eqLogics) : 'ok';
      case 'cmd::all':
        return structuredClone(box.cmds);
      case 'event::changes': {
        box.clock += 0.01;
        return {
          datetime: box.clock,
          result: box.events.filter((e) => Number(e.datetime) >= Number(params.datetime)),
        };
      }
      case 'cmd::execCmd': {
        const error = box.execErrors[params.id];
        if (error) {
          throw error;
        }
        box.executed.push({ id: params.id, options: params.options });
        return 'ok';
      }
      default:
        throw new JeedomError('api', `Aucune méthode correspondante : ${method}`, { code: 500 });
    }
  };

  box.connect = (config) => {
    const client = {
      config,
      closed: false,
      async call(method, params = {}) {
        box.calls.push({ method, params });
        if (box.fail) {
          throw box.fail;
        }
        if (config.apiKey !== apiKey) {
          throw new JeedomError('auth', "Vous n'êtes pas autorisé à effectuer cette action", {
            code: 2,
          });
        }
        return answer(method, params);
      },
      close() {
        client.closed = true;
      },
    };
    box.clients.push(client);
    return client;
  };

  return box;
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
