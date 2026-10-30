"""add dm_custom_ruleset to user_settings

Player-defined species and classes for the DM character wizard. Kept in the
database rather than ruleset_simple.json so an app update cannot overwrite
what the player created.

Revision ID: c4d9a2e6b815
Revises: f6b3c1a8d904
Create Date: 2026-09-09

"""
from alembic import op
import sqlalchemy as sa


revision = 'c4d9a2e6b815'
down_revision = 'f6b3c1a8d904'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('dm_custom_ruleset', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_settings', 'dm_custom_ruleset')
