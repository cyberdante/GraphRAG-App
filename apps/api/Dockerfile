# The service, with the extras a full stack needs.
#
# Build context is the repository root, because the service is one workspace in
# a monorepo and the image should be buildable the same way from anywhere in
# it.
FROM python:3.12-slim

# Bytecode files and pip's cache are dead weight in a layer, and unbuffered
# output is what makes `docker compose logs -f` show anything while a request
# is still streaming.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# Dependencies resolve from the project metadata alone, so this layer survives
# every change that does not touch pyproject.toml.
COPY apps/api/pyproject.toml ./pyproject.toml
COPY apps/api/README.md* ./
RUN mkdir -p app && touch app/__init__.py && pip install --no-cache-dir ".[llm,graph]"

COPY apps/api/app ./app
COPY apps/api/scripts ./scripts

# Runs unprivileged. Nothing here needs root, and a container that never needed
# it should not be the one that has it.
RUN useradd --system --create-home --uid 10001 ragstone \
    && chown -R ragstone:ragstone /srv
USER ragstone

EXPOSE 8000

# Binds to every interface *inside the container*; compose decides what that is
# reachable from.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
