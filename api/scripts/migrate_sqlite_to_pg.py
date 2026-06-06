"""
Migrate data from foliantica.db (SQLite) into a fresh PostgreSQL database.

Called by electron/main.js on first launch when:
  - pgdata/ was just initialised (first PG run), AND
  - foliantica.db exists in the data directory.

The script copies every table row-for-row and then resets PostgreSQL SERIAL
sequences so subsequent inserts don't collide with migrated IDs.

On completion, foliantica.db is renamed to foliantica.db.bak (never deleted).

Usage:
  python migrate_sqlite_to_pg.py \\
      --sqlite-path /path/to/foliantica.db \\
      [--pg-port 5433] [--pg-user foliantica] \\
      [--pg-pass foliantica] [--pg-db foliantica]
"""
import argparse
import sys
from pathlib import Path


def migrate(sqlite_path: str, pg_port: str, pg_user: str, pg_pass: str, pg_db: str, keep_original: bool = False) -> None:
    from sqlalchemy import create_engine, inspect, text

    sqlite_url = f"sqlite:///{sqlite_path}"
    pg_url     = f"postgresql+psycopg2://{pg_user}:{pg_pass}@127.0.0.1:{pg_port}/{pg_db}"

    sqlite_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    pg_engine     = create_engine(pg_url)

    sqlite_insp = inspect(sqlite_engine)
    pg_insp     = inspect(pg_engine)

    sqlite_tables = set(sqlite_insp.get_table_names())
    pg_tables     = set(pg_insp.get_table_names())

    # Tables that exist in the PostgreSQL schema (created by Base.metadata.create_all)
    target_tables = sorted(sqlite_tables & pg_tables - {"sqlite_sequence"})

    migrated: list[str] = []

    with pg_engine.begin() as pg_conn:
        # Temporarily disable FK checks so we can insert in any order
        pg_conn.execute(text("SET session_replication_role = replica"))

        for table in target_tables:
            # Idempotent: skip if PG already has rows in this table
            pg_count = pg_conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            if pg_count and pg_count > 0:
                print(f"  {table}: already has {pg_count} rows — skipping")
                continue

            with sqlite_engine.connect() as sq_conn:
                rows = sq_conn.execute(text(f"SELECT * FROM {table}")).fetchall()

            if not rows:
                print(f"  {table}: empty — skipping")
                continue

            col_info  = sqlite_insp.get_columns(table)
            col_names = [c["name"] for c in col_info]

            placeholders = ", ".join(f":{c}" for c in col_names)
            cols_sql     = ", ".join(col_names)
            row_dicts    = [dict(zip(col_names, row)) for row in rows]

            pg_conn.execute(
                text(f"INSERT INTO {table} ({cols_sql}) VALUES ({placeholders})"),
                row_dicts,
            )
            print(f"  {table}: migrated {len(rows)} rows")
            migrated.append(table)

        # Re-enable FK checks
        pg_conn.execute(text("SET session_replication_role = DEFAULT"))

        # Reset SERIAL sequences for every migrated table that has an 'id' column,
        # so new inserts won't collide with the IDs we just imported.
        for table in migrated:
            try:
                seq = pg_conn.execute(
                    text("SELECT pg_get_serial_sequence(:tbl, 'id')"),
                    {"tbl": table},
                ).scalar()
                if seq:
                    pg_conn.execute(
                        text(f"SELECT setval('{seq}', COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)")
                    )
            except Exception:
                pass  # table has no 'id' column or no sequence — safe to ignore

    print(f"\nMigration complete. {len(migrated)} table(s) copied.")

    if not keep_original:
        # Rename the source SQLite DB to .bak — keep it as a safety net.
        bak = Path(sqlite_path).with_suffix(".db.bak")
        Path(sqlite_path).rename(bak)
        print(f"SQLite database backed up to: {bak}")
    else:
        print(f"SQLite database kept at: {sqlite_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate Foliantica data from SQLite to PostgreSQL")
    parser.add_argument("--sqlite-path", required=True,  help="Absolute path to foliantica.db")
    parser.add_argument("--pg-port",     default="5433", help="PostgreSQL port (default: 5433)")
    parser.add_argument("--pg-user",       default="foliantica")
    parser.add_argument("--pg-pass",       default="foliantica")
    parser.add_argument("--pg-db",         default="foliantica")
    parser.add_argument("--keep-original", action="store_true",
                        help="Keep the SQLite .db file instead of renaming it to .db.bak")
    args = parser.parse_args()

    if not Path(args.sqlite_path).exists():
        print(f"ERROR: SQLite database not found: {args.sqlite_path}", file=sys.stderr)
        sys.exit(1)

    migrate(args.sqlite_path, args.pg_port, args.pg_user, args.pg_pass, args.pg_db,
            keep_original=args.keep_original)
