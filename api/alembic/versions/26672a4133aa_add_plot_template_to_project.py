"""add plot_template to project

Revision ID: 26672a4133aa
Revises:
Create Date: 2026-06-21

"""
from alembic import op
import sqlalchemy as sa


revision = '26672a4133aa'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('plot_template', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'plot_template')
