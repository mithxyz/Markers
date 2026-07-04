#!/usr/bin/env bash
# /root/markers/scripts/backup.sh
# Nightly pg_dump → S3 backup for the markers (cue.mith.studio) Postgres DB.
# Modelled directly on /root/argus/scripts/backup.sh — keep the two in sync.
# Credentials sourced from /root/markers/.backup-env (mode 600, never echoed).
set -euo pipefail

ENV_FILE="/root/markers/.backup-env"
LOG_DIR="/var/log/markers-backup"
LOGFILE="$LOG_DIR/backup-$(date +%Y%m%d).log"
STATUS_FILE="$LOG_DIR/status.json"        # latest run, atomically replaced
HISTORY_FILE="$LOG_DIR/history.jsonl"     # append-only, one line per run
TMPDIR_BASE="/tmp/markers-backup-$$"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"
PG_DUMP_BYTES=""
PG_S3_KEY=""

mkdir -p "$LOG_DIR"
exec >> "$LOGFILE" 2>&1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

write_status() {
    local rc="$1"
    local finished_at finished_epoch duration
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    finished_epoch="$(date +%s)"
    duration=$((finished_epoch - STARTED_EPOCH))
    local success="false"
    [[ "$rc" == "0" ]] && success="true"
    local payload
    payload=$(cat <<EOF
{"started_at":"$STARTED_AT","finished_at":"$finished_at","success":$success,"exit_code":$rc,"duration_seconds":$duration,"prefix":"${PREFIX:-}","pg_dump_key":"${PG_S3_KEY:-}","pg_dump_bytes":${PG_DUMP_BYTES:-null},"bucket":"${BACKUP_S3_BUCKET:-}","logfile":"$LOGFILE"}
EOF
    )
    printf '%s\n' "$payload" > "$STATUS_FILE.tmp"
    mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
    chmod 0644 "$STATUS_FILE"
    printf '%s\n' "$payload" >> "$HISTORY_FILE"
    chmod 0644 "$HISTORY_FILE" 2>/dev/null || true
}

cleanup() {
    local rc=$?
    log "Cleaning up temp dir $TMPDIR_BASE"
    rm -rf "$TMPDIR_BASE"
    write_status "$rc" || true
    if [[ $rc -ne 0 ]]; then
        log "BACKUP FAILED with exit code $rc"
    fi
    exit $rc
}
trap cleanup EXIT

# --- Load credentials (never printed) ---
if [[ ! -f "$ENV_FILE" ]]; then
    log "ERROR: $ENV_FILE not found — create it from .backup-env.example"; exit 1
fi
# shellcheck source=/root/markers/.backup-env
source "$ENV_FILE"

export AWS_ACCESS_KEY_ID="$BACKUP_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_AWS_REGION"
export PGPASSWORD="$BACKUP_DB_PASSWORD"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=Mon … 7=Sun
mkdir -p "$TMPDIR_BASE"

if [[ "$DAY_OF_WEEK" == "7" ]]; then
    PREFIX="weekly"
else
    PREFIX="daily"
fi

log "=== markers backup started (prefix=$PREFIX, ts=$TIMESTAMP) ==="

# --- 1. Postgres custom-format dump from the docker container ---
PG_DUMP_FILE="$TMPDIR_BASE/markers_${TIMESTAMP}.dump"
log "Dumping Postgres DB '$BACKUP_DB_NAME' from container '$BACKUP_PG_CONTAINER'..."
docker exec -e PGPASSWORD="$BACKUP_DB_PASSWORD" "$BACKUP_PG_CONTAINER" \
    pg_dump \
    -U "$BACKUP_DB_USER" \
    -d "$BACKUP_DB_NAME" \
    -Fc \
    --no-password \
    > "$PG_DUMP_FILE"

PG_SIZE=$(du -sh "$PG_DUMP_FILE" | cut -f1)
PG_DUMP_BYTES=$(stat -c%s "$PG_DUMP_FILE")
log "Postgres dump complete: $PG_DUMP_FILE ($PG_SIZE)"

# --- 2. Upload to S3 ---
# Media files already live in the versioned cue-markers bucket — only the DB
# dump needs to be backed up here.
S3_PG_KEY="backups/$PREFIX/$(date +%Y/%m/%d)/markers_${TIMESTAMP}.dump"
PG_S3_KEY="$S3_PG_KEY"

log "Uploading Postgres dump to s3://$BACKUP_S3_BUCKET/$S3_PG_KEY ..."
aws s3 cp "$PG_DUMP_FILE" "s3://$BACKUP_S3_BUCKET/$S3_PG_KEY" \
    --sse AES256 \
    --checksum-algorithm SHA256 \
    --no-progress

# --- 3. Verify upload exists in S3 ---
log "Verifying upload..."
aws s3 ls "s3://$BACKUP_S3_BUCKET/$S3_PG_KEY" | grep -q "$(basename "$S3_PG_KEY")" \
    && log "S3 verify OK: $S3_PG_KEY" \
    || { log "ERROR: S3 verify FAILED for $S3_PG_KEY"; exit 1; }

# --- 4. Rotate old log files (keep 35 days) ---
find "$LOG_DIR" -name "backup-*.log" -mtime +35 -delete 2>/dev/null || true

log "=== markers backup completed successfully ==="
log "  Postgres: s3://$BACKUP_S3_BUCKET/$S3_PG_KEY ($PG_SIZE)"
