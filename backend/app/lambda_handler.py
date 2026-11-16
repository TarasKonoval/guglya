"""AWS Lambda entrypoint: FastAPI behind API Gateway HTTP API, via Mangum."""
from mangum import Mangum

from .db import pool
from .main import app

# Open the pool once per container; Mangum's per-invocation lifespan would reopen it on every request.
pool.open()
handler = Mangum(app, lifespan="off")
