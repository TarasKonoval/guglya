"""AWS Lambda entrypoint: FastAPI behind API Gateway HTTP API, via Mangum."""
from mangum import Mangum

from .main import app

# lifespan off: the DB pool opens lazily on first query (see db.py).
handler = Mangum(app, lifespan="off")
