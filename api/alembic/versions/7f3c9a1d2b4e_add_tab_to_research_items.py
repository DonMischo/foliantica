"""add tab to research_items

Revision ID: 7f3c9a1d2b4e
Revises: 26672a4133aa
Create Date: 2026-07-15

"""
from alembic import op
import sqlalchemy as sa


revision = '7f3c9a1d2b4e'
down_revision = '26672a4133aa'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'research_items',
        sa.Column('tab', sa.String(length=100), nullable=False, server_default='research'),
    )


def downgrade() -> None:
    op.drop_column('research_items', 'tab')
