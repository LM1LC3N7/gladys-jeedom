// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button), in English and French.
// Never put the API key in one of them.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Why Jeedom is unreachable, with the hint that fits. */
function unreachable(err) {
  const reason = err?.message ?? 'unknown error';
  const hints = {
    certificate: {
      en: 'For a self-signed certificate, turn off "Verify the TLS certificate".',
      fr: 'Pour un certificat auto-signé, désactivez « Vérifier le certificat TLS ».',
    },
    redirect: {
      en: 'Type the address Jeedom redirects to.',
      fr: "Saisissez l'adresse vers laquelle Jeedom redirige.",
    },
    http: {
      en: 'Check the address. After failed logins, Jeedom also bans the caller for a while.',
      fr: "Vérifiez l'adresse. Après des échecs de connexion, Jeedom bannit aussi l'appelant un moment.",
    },
    format: {
      en: 'Is it the address of your Jeedom box?',
      fr: "Est-ce bien l'adresse de votre box Jeedom ?",
    },
  };
  const hint = hints[err?.kind] ?? {
    en: 'Use its LAN IP address (not localhost). Retrying in a few seconds.',
    fr: 'Utilisez son adresse IP sur le réseau local (pas localhost). Nouvel essai dans quelques secondes.',
  };
  return {
    en: `Jeedom is unreachable: ${reason}. ${hint.en}`,
    fr: `Jeedom est injoignable : ${reason}. ${hint.fr}`,
  };
}

export const T = {
  notConfigured: {
    en: 'Type the address of your Jeedom box (for example http://192.168.1.20) and its API key in the configuration.',
    fr: "Saisissez l'adresse de votre box Jeedom (par exemple http://192.168.1.20) et sa clé API dans la configuration.",
  },
  noKey: {
    en: 'Paste the API key of Jeedom (Settings → System → Configuration → API) in the configuration.',
    fr: 'Collez la clé API de Jeedom (Réglages → Système → Configuration → API) dans la configuration.',
  },
  badUrl: (reason) =>
    reason === 'credentials'
      ? {
          en: 'No user name or password in the address: the API key is the only credential.',
          fr: "Pas d'utilisateur ni de mot de passe dans l'adresse : la clé API suffit.",
        }
      : {
          en: 'The address of Jeedom is not valid: use http://192.168.1.20 or https://jeedom.lan.',
          fr: "L'adresse de Jeedom n'est pas valide : utilisez http://192.168.1.20 ou https://jeedom.lan.",
        },
  /** The status of a configuration error (see normalizeConfig). */
  configError(error) {
    if (error === 'empty') {
      return T.notConfigured;
    }
    return error === 'no-key' ? T.noKey : T.badUrl(error);
  },
  connecting: {
    en: 'Connecting to Jeedom…',
    fr: 'Connexion à Jeedom…',
  },
  connected: (version, devices) => ({
    en: `Connected to Jeedom ${version}: ${plural(devices, 'device', 'devices')} in Discovery.`,
    fr: `Connecté à Jeedom ${version} : ${plural(devices, 'appareil', 'appareils')} dans Découverte.`,
  }),
  /** The status of a failed call (a JeedomError). */
  failure(err) {
    if (err?.kind === 'auth') {
      return {
        en: 'Jeedom refused the API key: copy it again from Settings → System → Configuration → API in Jeedom.',
        fr: 'Jeedom a refusé la clé API : recopiez-la depuis Réglages → Système → Configuration → API dans Jeedom.',
      };
    }
    if (err?.kind === 'forbidden') {
      return {
        en: `Jeedom refused the access (${err.message}): check in Settings → System → Configuration → API that the API access is enabled and allows the address of the Gladys machine.`,
        fr: `Jeedom a refusé l'accès (${err.message}) : vérifiez dans Réglages → Système → Configuration → API que l'accès API est activé et autorise l'adresse de la machine Gladys.`,
      };
    }
    if (err?.kind === 'api') {
      return {
        en: `Jeedom answered with an error: ${err.message}.`,
        fr: `Jeedom a répondu par une erreur : ${err.message}.`,
      };
    }
    return unreachable(err);
  },
  test: {
    ok: ({ version, devices, equipments, commands, disabled, hidden, empty }) => {
      const left = disabled + hidden + empty;
      return {
        en:
          `Connection OK, Jeedom ${version}: ${plural(equipments + disabled + hidden, 'equipment', 'equipments')}, ` +
          `${plural(commands, 'command', 'commands')}. ${plural(devices, 'device', 'devices')} offered in Discovery` +
          (left > 0
            ? `, ${left} left out (${disabled} disabled, ${hidden} hidden, ${empty} with nothing to offer).`
            : '.'),
        fr:
          `Connexion OK, Jeedom ${version} : ${plural(equipments + disabled + hidden, 'équipement', 'équipements')}, ` +
          `${plural(commands, 'commande', 'commandes')}. ${plural(devices, 'appareil proposé', 'appareils proposés')} dans Découverte` +
          (left > 0
            ? `, ${left} écarté${left === 1 ? '' : 's'} (${disabled} désactivé${disabled === 1 ? '' : 's'}, ${hidden} masqué${hidden === 1 ? '' : 's'}, ${empty} sans rien à proposer).`
            : '.'),
      };
    },
  },
};
