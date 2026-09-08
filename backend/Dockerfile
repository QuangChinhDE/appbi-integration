# The product API and the worker share this image: they are the same codebase
# with different entrypoints, and building twice would let them drift.

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Build tooling for the wheels that need it, removed in the same layer so it is
# not carried in the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl procps \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

# The installer, so the image can migrate itself.
#
# The migration Job, the compose `migrate` service and a developer's laptop all
# run the same `install.py`, and it has to be *in* the image for the Job: a
# mounted copy needs a volume the Kubernetes manifests would have to invent,
# and a ConfigMap copy is a second copy that drifts. `install.py` finds
# `alembic.ini` by looking at the working directory, which is `/app` here.
COPY --from=repo-scripts install.py doctor.py /opt/install/

# Non-root, and the app owns nothing it writes: everything durable is in
# Postgres or the secret store.
RUN useradd --create-home --uid 10001 appbi && chown -R appbi:appbi /app
USER appbi

EXPOSE 8000

# The shallow probe on purpose: an engine outage must not take every API
# instance out of rotation (see app/core/readiness.py).
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8000/readyz > /dev/null || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
