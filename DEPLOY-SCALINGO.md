# Déployer nao sur Scalingo (1 instance par produit)

Méthode de déploiement de [nao](https://getnao.io) sur **Scalingo** via **buildpacks**
(Scalingo ne déploie pas d'image Docker). Chaque produit a **sa propre instance** : une app,
une base PostgreSQL, un repo de contexte et une clé LLM dédiés → **données isolées**.

## Architecture

nao est un monorepo polyglotte. Sur Scalingo on reproduit le build Docker amont avec un
**multi-buildpack** et on lance **deux process dans le conteneur `web`** :

- **backend** (Bun) : `bun run apps/backend/src/cli.ts serve --port $PORT` — sert aussi le frontend (build Vite) en statique.
- **sidecar FastAPI** (Python/uvicorn) sur `127.0.0.1:8005` — le backend l'appelle en `localhost` (codé en dur amont).

Les deux sont co-localisés (pas de réseau privé) car le backend appelle FastAPI en `localhost` ; les
séparer imposerait de patcher le code amont (`execute-sql.ts`, `live-story.ts`).

## Fichiers de cet overlay

| Fichier | Rôle |
|---|---|
| `.buildpacks` | apt → python → bun (le dernier fixe le start) |
| `Aptfile` | paquets système (git, chromium, libpq, openssh, deps build Python) |
| `.python-version` | Python 3.12 |
| `requirements.txt` | `uv` (déclenche la détection du python-buildpack) |
| `.slugignore` | allège le slug (<2 GiB) |
| `Procfile` | `release` (migrations) + `web` (sidecar + backend) |
| `bin/build.sh` | hook `heroku-postbuild` → build Python + JS |
| `bin/build-python.sh` | `uv pip install '.[all]'` (FastAPI, ibis, providers LLM dont mistral) |
| `bin/build-js.sh` | `bun install` + `vite build` du frontend |
| `bin/web.sh` | clone du contexte git + sidecar + backend sur `$PORT` |
| `bin/release.sh` | migrations Drizzle (gating déploiement) |
| `scalingo.json` | manifeste addons + env (review apps / one-click) |
| `nao-scalingo.sh` | gère une instance : create / deploy / logs / env / scale / destroy… |
| `fgp-scopes.json` | scopes de l'accès restreint aux apps `nao-*` (agents, CI) |
| `.env.fgp.example` | gabarit de `.env.fgp` (clé + blob FGP, jamais commité) |
| `instances/<produit>/` | (optionnel) fichiers qui écrasent la base pour une instance (ex. `Procfile`) |
| `package.json` | ajout du script `heroku-postbuild` (seule modif d'un fichier amont) |

## Pré-requis

1. **CLI Scalingo** installée et authentifiée : `scalingo login`.
2. **Accès région `osc-secnum-fr1`** (SecNumCloud) activé par le support Scalingo (entité EU requise).
3. Le repo de déploiement (ce fork) poussé sur GitHub (`incubateur-territoires/nao-scalingo`).

## Gérer les instances : `nao-scalingo.sh`

Toutes les opérations passent par `./nao-scalingo.sh <commande> <produit>` (voir `./nao-scalingo.sh help`).

**Créer une instance** (provisionne app + PostgreSQL + env + 1er déploiement) :

```bash
NAO_CONTEXT_GIT_URL=https://github.com/incubateur-territoires/contexte-<produit>.git \
ANTHROPIC_API_KEY=sk-ant-... \
./nao-scalingo.sh create <produit>
```

Variables reconnues : `NAO_CONTEXT_GIT_URL` (requis), `ANTHROPIC_API_KEY`/`MISTRAL_API_KEY`/`OPENAI_API_KEY`,
`NAO_CONTEXT_GIT_BRANCH`, `NAO_CONTEXT_GIT_SUBPATH`, `NAO_CONTEXT_GIT_TOKEN` (repo privé),
`DB_URI` (DB externe → implique `--no-pg`),
`SCALINGO_REGION` (déf. `osc-secnum-fr1`), `PG_PLAN`, `WEB_SIZE`.

`create` est **idempotent** : Scalingo est la source de vérité des variables d'env, donc relancer
`create <produit>` relit les valeurs déjà posées (inutile de repasser `NAO_CONTEXT_GIT_URL`) et ne
**régénère jamais** `BETTER_AUTH_SECRET`.

**Opérations courantes :**

```bash
./nao-scalingo.sh deploy <produit>        # redéploie le HEAD courant (ne touche PAS à l'env)
./nao-scalingo.sh logs <produit>          # suit les logs
./nao-scalingo.sh set-key <produit>       # pose ANTHROPIC_API_KEY=... lu dans l'env
./nao-scalingo.sh set-env <produit> K=V   # définit une variable d'env
./nao-scalingo.sh restart <produit>
./nao-scalingo.sh scale <produit> XL
./nao-scalingo.sh destroy <produit>       # détruit l'app + base (confirmation)
```

## Accès restreint via FGP (agents, CI)

Le CLI Scalingo authentifié donne les **pleins droits sur le compte**. Pour qu'un agent (Claude
Code) ou une CI n'agisse que sur les apps `nao-*`, le script sait aussi parler à l'API Scalingo
derrière [fine-grained-proxy](https://fgp.incubateur.net) : un proxy sans état qui ne laisse passer
que les méthodes et chemins déclarés dans un blob chiffré (`fgp-scopes.json`).

Le script bascule tout seul : si `FGP_BLOB` est défini (en environnement, ou dans `.env.fgp` lu au
démarrage), il passe par le proxy ; sinon il utilise le CLI.

### Générer le blob

Avec un token API Scalingo **dédié** (dashboard → Profil → Tokens), pour pouvoir le révoquer seul :

```bash
read -rs SCALINGO_API_TOKEN            # évite de laisser le token dans l'historique
jq -n --arg token "$SCALINGO_API_TOKEN" --slurpfile scopes fgp-scopes.json \
  '{token: $token, target: "https://api.osc-secnum-fr1.scalingo.com",
    auth: "scalingo-exchange", scopes: $scopes[0], ttl: 2592000}' |
  curl -sS -X POST https://fgp.incubateur.net/api/generate \
    -H 'Content-Type: application/json' --data @- |
  jq -r '"FGP_KEY=\(.key)\nFGP_BLOB=\(.blob)"' > .env.fgp
unset SCALINGO_API_TOKEN
```

`ttl` est en secondes (2592000 = 30 jours ; `0` = sans expiration, déconseillé). La clé n'est
renvoyée qu'une fois : sans elle le blob est inutilisable.

Le token Scalingo n'est ni stocké par le proxy ni récupérable depuis le blob — le déchiffrement
exige la clé client **et** un sel connu du seul serveur. En revanche `fgp.incubateur.net` voit le
token en clair à la génération, puis à chaque échange (bearer gardé en mémoire 55 min) : c'est un
tiers de confiance à assumer, ou à auto-héberger (le projet est open source).

### Ce que le blob couvre

| Commande | Appels Scalingo | Mode FGP |
|---|---|---|
| `deploy` / `update` | `POST /v1/sources`, `PUT` sur l'URL pré-signée, `POST /v1/apps/nao-*/deployments` | oui, avec suivi du statut |
| `env`, `set-env`, `set-key` | `GET` et `PUT /v1/apps/nao-*/variables` | oui |
| `restart`, `scale`, `status`, `cache-clear` | endpoints correspondants sous `/v1/apps/nao-*` | oui |
| `create` | `POST /v1/apps` (nom `nao-*`, sans parent) puis `POST /v1/apps/nao-*/addons` | oui |
| `run` | `POST /v1/apps/nao-*/run` | oui, en détaché (sortie dans les logs) |
| `logs` | `GET /v1/apps/nao-*/logs` puis l'URL signée renvoyée | oui, n dernières lignes |
| `list`, `destroy`, `open`, `logs -f`, `run` interactif | — | non : réservés au CLI |

`list` verrait toutes les apps du compte, `destroy` est irréversible : les deux sortent du blob et
le script les refuse explicitement en mode FGP.

### Vérifier l'étanchéité

```bash
./nao-scalingo.sh check <produit>   # lit l'app visée, puis vérifie que GET /v1/apps est refusé
```

Recette faite en amont avec un blob jetable (token bidon : les appels autorisés s'arrêtent à
l'échange de token, donc rien n'est créé) :

| Requête | Résultat |
|---|---|
| `GET /v1/apps/nao-…` | passe le scope (`502 auth_exchange_failed`, token bidon) |
| `GET /v1/apps/autre-app` | `403 scope_denied` |
| `PUT /v1/apps/autre/variables` | `403 scope_denied` |
| `POST /v1/apps` avec `name: "autre-foo"` | `403 scope_denied` |
| `DELETE /v1/apps/nao-x` | `403 scope_denied` |
| `GET /v1/apps/nao-x/../autre/variables` | `403 scope_denied` |
| `GET /v1/apps/nao-x%2f..%2fautre/variables` | `403 scope_denied` |

### Le cas `parent_id` (réglé)

`POST /v1/apps` accepte un `parent_id` qui peut désigner n'importe quelle app du compte, et une app
`nao-*` créée comme enfant d'une app hors périmètre pourrait en hériter la configuration. FGP ne
sait pas exiger l'**absence** d'un champ, donc `fgp-scopes.json` exige un `app.parent_id` **vide** et
le script envoie toujours `"parent_id": ""`.

Validé en direct : l'API Scalingo accepte `"parent_id": ""` et crée l'app normalement, et le blob
refuse la même requête si le champ est absent ou désigne une autre app. La suppression de l'app
créée reste hors scope (`403`), donc au CLI.

### Fermer l'accès complet sur le poste de l'agent

Le blob ne restreint rien tant que le token complet du CLI reste lisible (`~/.config/scalingo/auth`).
Le sandbox de Claude Code s'en charge, réparti sur deux fichiers pour n'être actif que sur ce projet.

**`~/.claude/settings.json`** (global) porte la politique, inerte tant que le sandbox n'est pas activé
quelque part. Les entrées `sandbox.credentials` ne sont lues **que** depuis ce fichier : dans les
réglages d'un projet elles sont ignorées, comme `network.strictAllowlist` et `filesystem.disabled`.

```json
{
  "permissions": { "deny": ["Read(~/.config/scalingo/**)"] },
  "sandbox": {
    "allowUnsandboxedCommands": false,
    "credentials": { "files": [{ "path": "~/.config/scalingo", "mode": "deny" }] }
  }
}
```

**`.claude/settings.local.json`** (ce projet, ignoré par git) allume le sandbox et déclare les
domaines joignables :

```json
{
  "sandbox": {
    "enabled": true,
    "network": {
      "allowedDomains": ["fgp.incubateur.net", "*.osc-secnum-fr1.scalingo.com", "github.com", "registry.npmjs.org"]
    }
  }
}
```

Le sandbox s'applique aux commandes Bash et à leurs sous-processus ; `permissions.deny` couvre en
plus l'outil de lecture de fichiers de l'agent, dans tous les projets. `allowUnsandboxedCommands:
false` retire l'échappatoire qui permettrait de relancer une commande hors sandbox.

Conséquence du découpage : dans un projet où le sandbox n'est pas allumé, le token n'est plus protégé
que par la règle `Read(...)`, qui couvre l'outil de lecture et les commandes de lecture reconnues,
mais pas un sous-processus qui lirait le fichier par un autre chemin (un script Python, le CLI
`scalingo` lui-même). Pour la même protection ailleurs, reprendre le bloc `sandbox.enabled` dans le
projet concerné.

`deploy` envoie l'archive sur une URL pré-signée du stockage Scalingo, dont l'hôte n'est pas connu à
l'avance : au premier déploiement, le sandbox nomme l'hôte refusé, à ajouter à `allowedDomains`.

Plus radical : `scalingo logout` sur cette machine, ou faire tourner l'agent dans une VM où
`~/.config/scalingo` n'existe pas.

### Customiser une instance (overlay)

Pour personnaliser une seule instance sans toucher la base commune, dépose des fichiers dans
`instances/<produit>/` : au déploiement, ils **écrasent** les fichiers de la racine (Procfile,
Aptfile, `.buildpacks`, `bin/`…).

**Exemple — base SOURCE derrière un bastion SSH via un tunnel** (cf. `instances/inclusion-numerique-prod/`) :

- `instances/<produit>/.buildpacks` ajoute le **ssh-private-key-buildpack** Scalingo en **premier** :

  ```
  https://github.com/Scalingo/ssh-private-key-buildpack.git
  https://github.com/Scalingo/apt-buildpack.git
  https://github.com/Scalingo/python-buildpack.git
  https://github.com/incubateur-territoires/scalingo-buildpack-bun
  ```

- `instances/<produit>/Procfile` ouvre le tunnel avant le serveur (le buildpack a installé la clé
  dans `~/.ssh`, donc pas de `-i`) :

  ```
  release: bash bin/release.sh
  web:     ssh -N -f -L $DS_BDD_IP $DS_BASTION_IP -p $DS_BASTION_PORT && bash bin/web.sh
  ```

Les **secrets restent en variables d'env Scalingo** (`./nao-scalingo.sh set-env <produit> ...`) :
`SSH_KEY` (clé privée **en base64**, lue par le buildpack), `SSH_HOSTS` (hôtes ajoutés à
`known_hosts`, dont le bastion), `DS_BDD_IP` (spec `-L`, ex. `5432:<hote-db>:5432`), `DS_BASTION_IP`
(`<user>@<bastion>`), `DS_BASTION_PORT`, et `NAO_DB_URL=postgres://…@127.0.0.1:<port_local>/…`
(la base source vue à travers le tunnel). La base **interne** de nao reste l'addon PostgreSQL
Scalingo (`DB_URI` auto-dérivé) — on **garde** l'addon (pas de `--no-pg`).

## Variables d'environnement clés

- `DB_URI` : **non défini manuellement** — `bin/web.sh` le dérive de `SCALINGO_POSTGRESQL_URL` (auto-roté).
- `BETTER_AUTH_SECRET` : secret de session, **stable** (sinon déconnexions au restart).
- `BETTER_AUTH_URL` : URL publique de l'app.
- LLM : `ANTHROPIC_API_KEY` (test initial) ou `MISTRAL_API_KEY` (Mistral est supporté nativement, cf. `cli/.[all]`).
  Le provider effectif se choisit dans le `nao_config.yaml` du repo de contexte.

## Maintenance / suivi upstream

Tous les ajouts sont des **fichiers neufs** ; seule modif amont = le script `heroku-postbuild` dans
`package.json`. La synchro se fait via le bouton **« Sync fork »** de GitHub sur `main`. En cas de conflit,
il ne portera que sur `package.json` (trivial à résoudre).

## À surveiller au premier déploiement

- **Taille du slug** (limite 2 GiB) : chromium + node_modules + site-packages Python. Si dépassement,
  retirer `chromium`/`chromium-driver` de l'`Aptfile` (à valider selon les fonctions utilisées).
- **Buildpack Bun** (`jakeg/heroku-buildpack-bun`, communautaire) : vérifier qu'il joue bien
  `heroku-postbuild` et fournit `bun` au runtime. Au besoin épingler un commit (`URL#<sha>`) ou tester `confact/bun-buildpack`.
- **Install Python via uv** : confirmer que `apps.backend.fastapi.main:app` s'importe au runtime
  (paquets dans le bon interpréteur). Voir `scalingo --app <app> run python -c "import fastapi"`.
- **Boxlite/KVM** : `@boxlite-ai/boxlite` attend `/dev/kvm` (absent) ; validé que l'exécution SQL passe par le sidecar FastAPI.
- **`vite build` sous Bun** : si un plugin exige le binaire `node`, ajouter `Scalingo/nodejs-buildpack.git`
  **avant** bun dans `.buildpacks`.
