import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from models import Base  # noqa: E402
target_metadata = Base.metadata

# Use the same Postgres connection as the app, overriding the ini default.
_pg_host = os.getenv("LW_PG_HOST", "127.0.0.1")
_pg_port = os.getenv("LW_PG_PORT", "5433")
_pg_user = os.getenv("LW_PG_USER", "foliantica")
_pg_pass = os.getenv("LW_PG_PASS", "foliantica")
_pg_db   = os.getenv("LW_PG_DB",   "foliantica")
_db_url = f"postgresql+psycopg2://{_pg_user}:{_pg_pass}@{_pg_host}:{_pg_port}/{_pg_db}"
config.set_main_option("sqlalchemy.url", _db_url)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
