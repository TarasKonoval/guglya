"""Apply infra/db/migrations/*.sql in filename order, each at most once.

Usage (from repo root):  DATABASE_URL=... python backend/scripts/migrate.py
"""
import os
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parents[2] / "infra" / "db" / "migrations"


def main() -> None:
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute(
            "create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())"
        )
        done = {r[0] for r in conn.execute("select name from schema_migrations")}
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in done:
                print("skip ", path.name)
                continue
            print("apply", path.name)
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("insert into schema_migrations (name) values (%s)", (path.name,))
            conn.commit()
    print("Migrations up to date.")


if __name__ == "__main__":
    main()
