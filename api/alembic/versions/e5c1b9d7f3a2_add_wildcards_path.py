"""add wildcards_path to user_settings

Revision ID: e5c1b9d7f3a2
Revises: d4f7a2c8e5b3
Create Date: 2026-07-19

"""
from alembic import op
import sqlalchemy as sa


revision = 'e5c1b9d7f3a2'
down_revision = 'd4f7a2c8e5b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('wildcards_path', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('user_settings', 'wildcards_path')
