"""add kind/d2 to research_items and default_diagram_model to user_settings

Revision ID: d7a3f1c9e2b4
Revises: c4d9a2e6b815
Create Date: 2026-11-13

"""
from alembic import op
import sqlalchemy as sa


revision = 'd7a3f1c9e2b4'
down_revision = 'c4d9a2e6b815'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('research_items', sa.Column('kind', sa.String(length=20), nullable=False, server_default='clipping'))
    op.add_column('research_items', sa.Column('d2', sa.Text(), nullable=True))
    op.add_column('user_settings', sa.Column('default_diagram_model', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('user_settings', 'default_diagram_model')
    op.drop_column('research_items', 'd2')
    op.drop_column('research_items', 'kind')
