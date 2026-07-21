"""add gender to codex entries

Revision ID: d4f7a2c8e5b3
Revises: b8e2f4a6c9d1
Create Date: 2026-07-19

"""
from alembic import op
import sqlalchemy as sa


revision = 'd4f7a2c8e5b3'
down_revision = 'b8e2f4a6c9d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('codex_entries', sa.Column('gender', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('codex_entries', 'gender')
