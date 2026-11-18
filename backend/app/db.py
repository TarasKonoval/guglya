import threading

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

# Tiny pool, opened on first use: a Lambda container serves one request at a time,
# and /health must work without touching the database.
pool = ConnectionPool(
    settings.database_url, min_size=0, max_size=2, kwargs={"row_factory": dict_row}, open=False
)
_lock = threading.Lock()
_opened = False


def _conn():
    global _opened
    if not _opened:
        with _lock:
            if not _opened:
                pool.open()
                _opened = True
    return pool.connection()


def fetch_all(sql: str, params: tuple | dict = ()) -> list[dict]:
    with _conn() as conn:
        return conn.execute(sql, params).fetchall()


def fetch_one(sql: str, params: tuple | dict = ()) -> dict | None:
    with _conn() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: tuple | dict = ()) -> None:
    with _conn() as conn:
        conn.execute(sql, params)


def transaction():
    """`with transaction() as conn:` - several statements, committed together (rolled back on error)."""
    return _conn()
