from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

# Small pool: on Lambda each container serves one request at a time.
pool = ConnectionPool(
    settings.database_url, min_size=1, max_size=4, kwargs={"row_factory": dict_row}, open=False
)


def fetch_all(sql: str, params: tuple | dict = ()) -> list[dict]:
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchall()


def fetch_one(sql: str, params: tuple | dict = ()) -> dict | None:
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: tuple | dict = ()) -> None:
    with pool.connection() as conn:
        conn.execute(sql, params)
