"""add autosave_interval to user_settings

Revision ID: f6b3c1a8d904
Revises: e5c1b9d7f3a2
Create Date: 2026-08-01

"""
from alembic import op
import sqlalchemy as sa


revision = 'f6b3c1a8d904'
down_revision = 'e5c1b9d7f3a2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column('autosave_interval', sa.Integer(), nullable=False, server_default='30'),
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'autosave_interval')
