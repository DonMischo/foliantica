"""add default_dm_model to user_settings

Revision ID: b8e2f4a6c9d1
Revises: a9c3e6f1d2b7
Create Date: 2026-07-19

"""
from alembic import op
import sqlalchemy as sa


revision = 'b8e2f4a6c9d1'
down_revision = 'a9c3e6f1d2b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('default_dm_model', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('user_settings', 'default_dm_model')
