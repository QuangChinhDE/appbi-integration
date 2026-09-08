# Releasing a build

How `v1.0.0-rc1` was cut, written as the procedure rather than as a story, so
the next one is the same. Every step has a check, because a release step
without one is a step somebody will skip when they are in a hurry.

The delivery scope is **internal** (ADR-015). `--delivery commercial` is
refused and should stay refused.

---

## 0. Before anything

```bash
git status --short          # must be empty
python scripts/certify.py --check
```

A dirty tree cannot be released: `release_gate.py` refuses one, because an
artefact naming a commit that does not describe what was built is worse than no
artefact.

---

## 1. Internal Git

The repository has no remote by default. Add the internal one, push both the
branch and the tag, and protect the branch — an unprotected default branch
makes the commit in the release artefact a claim rather than a record.

```bash
git remote add origin <internal-git-url>
git push -u origin master
git push origin --tags
```

Then, in the internal Git's settings: protect `master`, require review, forbid
force-push.

**Check.** `git ls-remote --heads origin master` names the same commit as
`git rev-parse HEAD`.

**Not this:** committing `node_modules`. It is 335 MB, it carries three
Enterprise-licensed files from `n8n-core` (ADR-015), and the lockfile plus
`scripts/mirror_bundle.py` reproduce it exactly.

---

## 2. Build once

Images are built once and moved as artefacts. Rebuilding per environment means
staging and production are different binaries with the same version number.

```bash
docker compose build
docker compose config --images        # what was built
```

**With an internal registry:**

```bash
docker tag appbi-workflow-api:latest  <registry>/appbi-workflow-api:v1.0.0-rc1
docker push                            <registry>/appbi-workflow-api:v1.0.0-rc1
# ...and the same for engine, frontend
docker inspect --format='{{index .RepoDigests 0}}' <registry>/appbi-workflow-api:v1.0.0-rc1
```

**Without one** — acceptable for a pilot, not beyond it:

```bash
python scripts/release_images.py --version v1.0.0-rc1 --out dist/images
```

That writes one tarball per image plus `SHA256SUMS`. Verify on the far side
with `sha256sum -c SHA256SUMS` before `docker load`, because a tarball copied
by hand is a tarball nobody checked.

**Check.** The digest or the SHA256 goes into the release artefact in step 4.
An image the artefact cannot name is an image nobody can roll back to.

---

## 3. Prove it installs from nothing

The decisive test, and the one that answers "does this need to clone n8n?".

```bash
git clone <internal-git-url> /tmp/staging && cd /tmp/staging
cp .env.example .env      # then fill in real secrets; see scripts/doctor.py
docker compose -p appbi-staging build --no-cache
docker compose -p appbi-staging up -d --wait
```

No reuse of anything: not `node_modules`, not an existing image, not a volume.
A fresh clone plus a fresh database.

Then, in order:

```bash
python scripts/mirror_bundle.py --out dist/mirror   # and --verify
docker compose -p appbi-staging run --rm api alembic upgrade head
python scripts/doctor.py --env-file .env
python scripts/certify.py --check
python scripts/smoke.py --base http://127.0.0.1:8020
python scripts/schema_drift.py --json
```

**Check.** All five pass, and `docker compose -p appbi-staging ps` shows
`engine` with **no host port** — guardrail 15, enforced by the compose file
rather than by anyone remembering.

---

## 4. The release artefact

```bash
# The reachability measurement the VEX is built from, first.
cd workflow-engine && npx vitest run tests/contract/reachability.test.ts && cd ..
python scripts/sbom.py --out release

python scripts/release_gate.py \
  --version 1.0.0-rc1 --delivery internal \
  --env-file .env.production --evidence ci-evidence.json \
  --drift-report drift.json
```

The artefact must name: the commit, the image digest or SHA256, the n8n
version, the migration revision at the head, the SBOM and VEX filenames with
their hashes, and the version to roll back to.

**Check.** `release_gate.py` exits zero. If it does not, it says which gate and
why; none of them is decoration.

---

## 5. Backups, off the machine

```bash
python scripts/backup.py --out /backups
python scripts/restore.py --dump /backups/<file> --database appbi_restore_check
```

Restore into a *different* database and sign in against it. A backup nobody has
restored is a belief, and the belief is usually wrong about the one thing that
matters — whether credentials decrypt under the key the restored deployment
has.

**Check.** After restore: sign in, the workspace is there, a credential shows
as configured and masked, and a workflow runs.

Then copy the dump off the machine. A backup on the host it protects is not a
backup.

---

## 6. Rollback

Know this before deploying, not during an incident.

```bash
docker compose pull   # or docker load the previous tarball
IMAGE_TAG=<previous> docker compose up -d --wait
```

Migrations are the constraint: an image can be rolled back freely, a schema
cannot. Before deploying, read the migrations in the release and decide whether
each is backward-compatible with the previous image. Additive columns are;
dropped or renamed ones are not, and those need the previous release to be
re-deployed against a restored backup rather than against the migrated
database.

`v1.0.0-rc1`'s three migrations are all additive — one column on `executions`,
one on `engine_instances`, one constraint — so the previous image runs against
the migrated schema unchanged.

---

## What the E2E suite must never touch

`e2e/` provisions tenants, scales the API to two replicas, and on
`--include-destructive` empties the database. `global.setup.ts` refuses to run
against a deployment holding workspaces the suite did not create; override it
only for a stack you are willing to lose:

```bash
E2E_TARGET_IS_DISPOSABLE=1 npx playwright test
```

Run it against its own stack instead:

```bash
docker compose -p appbi-e2e up -d --wait
```

Test tenants accumulate — roughly ten per run, and the product does not expose
deleting a tenant on purpose. Sweep them with:

```bash
python scripts/tenant_sweep.py --base <url> --password <admin> --dry-run
```
