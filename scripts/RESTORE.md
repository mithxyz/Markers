# markers DB — Restore Procedure

## List available backups

```bash
aws s3 ls s3://cue-markers/backups/ --recursive | sort | tail -20
```

## Download a dump

```bash
aws s3 cp s3://cue-markers/backups/daily/YYYY/MM/DD/markers_TIMESTAMP.dump /tmp/markers.dump
```

## Restore to production (destructive — replaces all data)

```bash
# 1. Stop the app so no writes land during restore
sudo systemctl stop markers markers-worker

# 2. Drop + recreate the target DB
docker exec -e PGPASSWORD=<password> markers-postgres \
  psql -U markers -c "DROP DATABASE IF EXISTS markers_restore; CREATE DATABASE markers_restore;"

# 3. Restore the dump
docker exec -i -e PGPASSWORD=<password> markers-postgres \
  pg_restore -U markers -d markers_restore -Fc --no-owner --no-acl /dev/stdin < /tmp/markers.dump

# 4. Spot-check row counts
docker exec -e PGPASSWORD=<password> markers-postgres \
  psql -U markers -d markers_restore \
  -c "SELECT table_name, (SELECT count(*) FROM information_schema.tables t2 WHERE t2.table_name = t.table_name) FROM information_schema.tables t WHERE table_schema='public' ORDER BY table_name;"

# 5. Swap databases (or update .env to point to markers_restore)
#    If satisfied, rename:
docker exec -e PGPASSWORD=<password> markers-postgres \
  psql -U markers -c "ALTER DATABASE markers RENAME TO markers_old; ALTER DATABASE markers_restore RENAME TO markers;"

# 6. Restart
sudo systemctl start markers markers-worker
```

## Tested restore record

| Date | Backup key | Row counts matched | Tester |
|------|-----------|-------------------|--------|
| (fill in after first successful test) | | | |
