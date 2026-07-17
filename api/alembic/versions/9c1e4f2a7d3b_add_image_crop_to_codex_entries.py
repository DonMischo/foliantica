"""add image_crop to codex_entries

Revision ID: 9c1e4f2a7d3b
Revises: 7f3c9a1d2b4e
Create Date: 2026-07-17

"""
from alembic import op
import sqlalchemy as sa


revision = '9c1e4f2a7d3b'
down_revision = '7f3c9a1d2b4e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('codex_entries', sa.Column('image_crop', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('codex_entries', 'image_crop')
