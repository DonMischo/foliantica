"""add kind to projects

Revision ID: c3f8a2d91e5b
Revises: 9c1e4f2a7d3b
Create Date: 2026-07-18

"""
from alembic import op
import sqlalchemy as sa


revision = 'c3f8a2d91e5b'
down_revision = '9c1e4f2a7d3b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('kind', sa.String(length=20), nullable=False, server_default='book'))


def downgrade() -> None:
    op.drop_column('projects', 'kind')
