# Passerelle Jeedom

Cette intégration relie Gladys à **votre box Jeedom** et propose chaque
équipement Jeedom dans l'onglet **Découverte** de Gladys : lumières, prises,
volets, thermostats, serrures, capteurs. Une fois un équipement ajouté, ses
états suivent Jeedom en quelques secondes, et Gladys le pilote **à travers
Jeedom**, qui continue de tourner. Passez à Gladys à votre rythme, pièce par
pièce, ou utilisez les deux côte à côte. Non officiel, sans lien avec Jeedom.

> **Version de développement (0.1).** Testée avec l'image Docker officielle de
> Jeedom (Jeedom 4.6) et des équipements de test, pas encore sur beaucoup de
> vraies box. Vos retours (et les types génériques de vos équipements) sont les
> bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

Gladys lit le **type générique** de chaque commande Jeedom (la colonne « Type
générique » de la configuration avancée d'une commande, renseignée
automatiquement par la plupart des plugins) :

| Types génériques Jeedom                                                                                | Dans Gladys                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Lumière état / on / off / toggle, slider, luminosité, couleur, température couleur                     | une lumière : allumage, luminosité, couleur, température de couleur |
| Prise, interrupteur, chauffage fil pilote, ventilateur, vanne, arrosage état / on / off (+ slider)     | un interrupteur (et un variateur)                                   |
| Volet état / monter / descendre / stop / slider (et fenêtres motorisées)                               | un volet : ouvrir, fermer, stop, position                           |
| Portail ou garage ouverture / fermeture / toggle, état portail ou garage                               | des boutons ouvrir / fermer, un capteur d'ouverture                 |
| Serrure état / ouvrir / fermer                                                                         | une serrure                                                         |
| Sirène état / on / off                                                                                 | une sirène                                                          |
| Thermostat consigne, températures, humidité, état, liste des modes, verrouillage                       | un thermostat : consigne, température, chauffe, liste des modes     |
| Plugin Mode, mode d'alarme                                                                             | une liste pour choisir le mode                                      |
| Température, humidité, pression, luminosité, UV, CO₂, CO, son, qualité de l'air, pluie, vent, distance | le capteur de la bonne catégorie                                    |
| Présence, porte, fenêtre, fumée, inondation, fuite d'eau, sabotage, choc                               | détecteurs de mouvement, d'ouverture, de fumée, de fuite, sabotage… |
| Puissance, consommation, tension, production                                                           | les mesures de la prise, ou d'un compteur d'énergie                 |
| Batterie, batterie en charge                                                                           | le niveau de batterie                                               |

Les **commandes info visibles sans type générique** sont aussi proposées : une
numérique comme une valeur (avec son unité quand Gladys la connaît), une texte
comme un texte. Les commandes masquées sans type générique, celles marquées
« Ne pas tenir compte de cette commande » et les commandes action sans type
générique sont écartées.

Chaque équipement Jeedom **activé et visible** donne **un appareil Gladys**,
nommé d'après l'équipement et sa pièce (« Lampe (Salon) ») ; l'objet Jeedom et
le plugin sont gardés dans ses paramètres. Les équipements désactivés ou
masqués sont écartés.

## Prérequis

- Jeedom 4.x (Jeedom 3 nomme autrement son API des objets et n'est pas pris en
  charge).
- La machine Gladys joint la box Jeedom sur le réseau local.
- L'accès API activé dans Jeedom : **Réglages → Système → Configuration**,
  onglet **API** : l'« Accès API » ne doit pas être désactivé, et s'il est
  limité aux « IP blanches », l'adresse de la machine Gladys doit en faire
  partie.

## Installation

1. Dans Jeedom, **Réglages → Système → Configuration**, onglet **API** : copiez
   la **Clé API** (celle du core, en haut). La clé API d'un utilisateur Jeedom
   fonctionne aussi : les droits de cet utilisateur s'appliquent alors.
2. Dans Gladys, ouvrez l'intégration, **Configuration** :
   - **Adresse de Jeedom** : l'adresse avec laquelle vous ouvrez Jeedom, vue
     depuis la machine Gladys : `http://192.168.1.20`, `https://jeedom.lan`, ou
     `http://hôte/jeedom` quand Jeedom est dans un sous-dossier. Pas
     `localhost` : l'intégration tourne dans son propre conteneur.
   - **Clé API de Jeedom** : collez-la.
3. Cliquez sur **Tester la connexion** : la version de Jeedom, le nombre
   d'équipements et de commandes, et le nombre d'appareils proposés
   s'affichent.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs
   valeurs sont envoyées dès l'ajout.

## Options

- **Vérifier le certificat TLS (https)** : activé par défaut. À désactiver
  seulement pour une box au certificat auto-signé sur votre réseau local.
- **Intervalle entre deux lectures des changements Jeedom** : 2 secondes par
  défaut (1 à 60). Gladys demande à Jeedom ce qui a changé à ce rythme.
- **Intervalle minimum entre deux mesures d'un capteur** : 10 secondes par
  défaut (0 à 300). Un compteur qui remonte chaque seconde est envoyé à Gladys à
  ce rythme. Interrupteurs, lumières, détecteurs de mouvement et d'ouverture ne
  sont jamais retardés.

## Bon à savoir

- **Jeedom reste aux commandes des modules** : Gladys envoie ses ordres aux
  commandes Jeedom, qui pilotent les modules Z-Wave, Zigbee, EnOcean… Gardez
  Jeedom en marche.
- **Un nouvel équipement** apparaît dans Découverte sous 10 minutes, tout de
  suite avec le bouton **Scanner** de l'onglet Découverte. Activer, désactiver,
  afficher ou masquer un équipement dans Jeedom est suivi en quelques secondes.
- **Badge de transport** : un appareil passe « injoignable » quand Jeedom est
  injoignable, ou quand sa commande « En ligne » (type générique) le dit hors
  ligne.
- **Les commandes qui demandent une confirmation ou un code d'accès** dans
  Jeedom sont refusées depuis Gladys : l'erreur s'affiche.
- **Un capteur de porte** : Jeedom dit 1 pour ouvert, Gladys 1 pour fermé ;
  l'intégration convertit. L'option « Inverser » d'une commande binaire dans
  Jeedom est respectée.
- Une commande dont le type générique est faux ou absent dans Jeedom apparaît
  comme une simple valeur : corrigez son type générique dans Jeedom
  (configuration avancée de la commande, ou **Outils → Types d'équipement**),
  puis cliquez sur **Scanner** dans Découverte.

## Dépannage

| Message d'état                                                 | Que faire                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jeedom a refusé la clé API                                     | Recopiez la clé (Réglages → Système → Configuration → API) et collez-la dans la configuration.                                                                 |
| Jeedom a refusé l'accès                                        | Dans Jeedom, vérifiez que l'accès API est activé et autorise l'adresse de la machine Gladys.                                                                   |
| Jeedom est injoignable : connection refused / host unreachable | Vérifiez l'adresse : l'IP de la box sur le réseau local, pas `localhost`. La box est-elle allumée ?                                                            |
| Jeedom est injoignable : HTTP 404                              | Vérifiez l'adresse. Après plusieurs échecs de connexion, Jeedom bannit aussi l'appelant un moment (Réglages → Système → Configuration → Sécurité, IP bannies). |
| certificate refused                                            | Un certificat auto-signé : désactivez « Vérifier le certificat TLS », ou utilisez `http://`.                                                                   |
| redirected to …                                                | Saisissez l'adresse vers laquelle Jeedom redirige.                                                                                                             |

Les logs de l'intégration (Gladys, page de l'intégration) donnent le détail.

## Vie privée

Tout reste sur votre réseau local : l'intégration ne parle qu'à votre box
Jeedom. La clé API est stockée comme un secret par Gladys et n'est jamais
écrite dans les logs.
