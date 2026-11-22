#!/usr/bin/env bash
#
# Copies a backup of the production database to this computer, and proves it arrived intact.
#
#   bash scripts/pull-backup.sh                      Railway: the linked project, service @glm/server
#   bash scripts/pull-backup.sh --service NAME       Railway, another service
#   bash scripts/pull-backup.sh --out DIR            Where to save it. Default ~/GoveeBackups, outside the repo
#   bash scripts/pull-backup.sh --docker CONTAINER   A local container instead of Railway (used by the CI)
#
# What it does on the server: makes a backup with the app's own backup command (SQLite's online
# backup, safe while the app runs) of the account file and, when there is one, the control
# database (users, sessions, encrypted keys), under /data/backups, sends it back compressed and base64
# encoded with its SHA-256 and size, then deletes that temporary copy. Each member's account file,
# which the backup command copies into a folder beside it, comes back the same way, one by one.
# Nothing else on the server changes, and the live databases are only read.
#
# Here, it checks the SHA-256 and size of what arrived, and runs SQLite's integrity check if the
# sqlite3 command is installed (it is on macOS). For the full check, against migrations and row
# counts, run `npm run db:verify -- <file>` after `npm run build`.
#
# The copy holds password hashes, the push signing keys, device names, schedules and each home's
# latitude and longitude, for the owner and every member. It is saved readable only by you. Never
# commit it.
#
# Needs: node on this computer; the Railway CLI, logged in and linked, for the Railway mode.
set -euo pipefail

SERVICE="@glm/server"
OUT="${HOME}/GoveeBackups"
DOCKER_CONTAINER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --service) SERVICE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --docker) DOCKER_CONTAINER="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# Runs on the server. Sent base64 encoded, so no quoting survives two shells.
read -r -d '' REMOTE <<'SH' || true
set -eu
cd /app
f="/data/backups/pull-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite"
node apps/server/dist/cli/backup.js "$f" >&2
node -e '
const fs = require("fs"), zlib = require("zlib"), crypto = require("crypto");
const f = process.argv[1];
const control = f.replace(/\.sqlite$/, ".control.sqlite");
const members = f.replace(/\.sqlite$/, ".accounts");
const send = (tag, buf) => process.stdout.write(
  "GLM-" + tag + "-BEGIN " + crypto.createHash("sha256").update(buf).digest("hex") + " " + buf.length + "\n" +
  zlib.gzipSync(buf).toString("base64").replace(/.{1,76}/g, "$&\n") + "GLM-" + tag + "-END\n");
try {
  send("DB", fs.readFileSync(f));
  if (fs.existsSync(f + ".manifest.json")) send("MANIFEST", fs.readFileSync(f + ".manifest.json"));
  if (fs.existsSync(control)) send("CONTROL", fs.readFileSync(control));
  if (fs.existsSync(control + ".manifest.json")) send("CONTROLMANIFEST", fs.readFileSync(control + ".manifest.json"));
  // Member account files are named accounts/<24 hex>.sqlite. Nothing else is sent.
  const names = fs.existsSync(members) ? fs.readdirSync(members).filter((n) => /^[0-9a-f]{24}\.sqlite$/.test(n)).sort() : [];
  for (const name of names) {
    const id = name.slice(0, 24);
    send("MEMBER-" + id, fs.readFileSync(members + "/" + name));
    if (fs.existsSync(members + "/" + name + ".manifest.json")) send("MEMBERMANIFEST-" + id, fs.readFileSync(members + "/" + name + ".manifest.json"));
  }
  process.stdout.write("GLM-MEMBERS " + names.length + "\n");
} finally {
  for (const file of [f, f + ".manifest.json", control, control + ".manifest.json"]) fs.rmSync(file, { force: true });
  fs.rmSync(members, { recursive: true, force: true });
}
' "$f"
SH
ENCODED="$(printf '%s\n' "$REMOTE" | base64 | tr -d '\n')"
REMOTE_COMMAND="echo $ENCODED | base64 -d | sh"

umask 077
mkdir -p "$OUT"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RAW="$OUT/.pull-$STAMP.txt"
trap 'rm -f "$RAW"' EXIT

if [ -n "$DOCKER_CONTAINER" ]; then
  echo "==> Backing up the database in container $DOCKER_CONTAINER" >&2
  docker exec -i "$DOCKER_CONTAINER" sh -c "$REMOTE_COMMAND" >"$RAW"
else
  echo "==> Backing up the production database on Railway, service $SERVICE" >&2
  railway ssh -s "$SERVICE" -- "$REMOTE_COMMAND" >"$RAW"
fi

DEST="$OUT/govee-light-manager-$STAMP.sqlite"
node -e '
const fs = require("fs"), zlib = require("zlib"), crypto = require("crypto");
const [raw, dest] = process.argv.slice(1);
const text = fs.readFileSync(raw, "utf8").replace(/\r/g, "");
const take = (tag) => {
  const m = text.match(new RegExp("GLM-" + tag + "-BEGIN ([0-9a-f]{64}) (\\d+)\\n([\\s\\S]*?)GLM-" + tag + "-END\\n"));
  if (!m) return null;
  let buf;
  try {
    buf = zlib.gunzipSync(Buffer.from(m[3].replace(/\s+/g, ""), "base64"));
  } catch (error) {
    console.error("The " + tag + " copy was damaged on the way and could not be unpacked (" + error.code + "). Nothing was saved. Run this again.");
    process.exit(1);
  }
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha !== m[1] || buf.length !== Number(m[2])) {
    console.error("The " + tag + " copy was damaged on the way: expected sha256 " + m[1] + " and " + m[2] + " bytes, got " + sha + " and " + buf.length);
    process.exit(1);
  }
  return { buf, sha };
};
const db = take("DB");
if (!db) { console.error("No backup came back from the server. Its output is above."); process.exit(1); }
fs.writeFileSync(dest, db.buf, { flag: "wx", mode: 0o600 });
const manifest = take("MANIFEST");
if (manifest) fs.writeFileSync(dest + ".manifest.json", manifest.buf, { flag: "wx", mode: 0o600 });
console.log("Saved " + dest + " (" + db.buf.length + " bytes, sha256 " + db.sha + ", matches the server)");
if (manifest) console.log("Saved " + dest + ".manifest.json");
// Users, sessions and encrypted keys. There is none on a server older than the control database.
const controlDest = dest.replace(/\.sqlite$/, ".control.sqlite");
const control = take("CONTROL");
if (control) {
  fs.writeFileSync(controlDest, control.buf, { flag: "wx", mode: 0o600 });
  console.log("Saved " + controlDest + " (" + control.buf.length + " bytes, sha256 " + control.sha + ", matches the server)");
  const controlManifest = take("CONTROLMANIFEST");
  if (controlManifest) fs.writeFileSync(controlDest + ".manifest.json", controlManifest.buf, { flag: "wx", mode: 0o600 });
} else {
  console.log("No control database came back (expected on a server older than it).");
}
// Member account files, each checked the same way, into a folder beside the backup.
const counted = text.match(/^GLM-MEMBERS (\d+)$/m);
const expected = counted ? Number(counted[1]) : 0;
const ids = [...text.matchAll(/^GLM-MEMBER-([0-9a-f]{24})-BEGIN /gm)].map((m) => m[1]);
if (ids.length !== expected) {
  console.error("The server sent " + expected + " member account(s), but " + ids.length + " arrived. Run this again.");
  process.exit(1);
}
if (ids.length > 0) {
  const dir = dest.replace(/\.sqlite$/, ".accounts");
  fs.mkdirSync(dir, { mode: 0o700 });
  for (const id of ids) {
    const member = take("MEMBER-" + id);
    fs.writeFileSync(dir + "/" + id + ".sqlite", member.buf, { flag: "wx", mode: 0o600 });
    const memberManifest = take("MEMBERMANIFEST-" + id);
    if (memberManifest) fs.writeFileSync(dir + "/" + id + ".sqlite.manifest.json", memberManifest.buf, { flag: "wx", mode: 0o600 });
  }
  console.log("Saved " + ids.length + " member account(s) in " + dir + ", each matching the server");
} else if (counted) {
  console.log("No member accounts on the server.");
}
' "$RAW" "$DEST"

if command -v sqlite3 >/dev/null 2>&1; then
  for FILE in "$DEST" "${DEST%.sqlite}.control.sqlite" "${DEST%.sqlite}.accounts/"*.sqlite; do
    [ -f "$FILE" ] || continue
    # Opened as immutable: read-only, no locks, and no -wal or -shm files created beside it,
    # even for a copy still in WAL mode. Characters with meaning in a URI are escaped.
    URI_PATH="${FILE//%/%25}"; URI_PATH="${URI_PATH//\?/%3f}"; URI_PATH="${URI_PATH//#/%23}"
    RESULT="$(sqlite3 "file:${URI_PATH}?immutable=1" 'PRAGMA integrity_check;')"
    if [ "$RESULT" != "ok" ]; then
      echo "SQLite's integrity check FAILED on $FILE: $RESULT" >&2
      exit 1
    fi
    echo "SQLite integrity check: ok ($(basename "$FILE"))"
  done
else
  echo "sqlite3 is not installed here, so the integrity check was skipped. Run: npm run db:verify -- $DEST"
fi
