"""add dm_facts and campaign_brief

Revision ID: a9c3e6f1d2b7
Revises: f2a8d5e7c4b1
Create Date: 2026-07-18

"""
from alembic import op
import sqlalchemy as sa


revision = 'a9c3e6f1d2b7'
down_revision = 'f2a8d5e7c4b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('campaign_brief', sa.Text(), nullable=True))
    op.create_table(
        'dm_facts',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), index=True),
        sa.Column('kind', sa.String(length=20), nullable=False, server_default='fact'),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('codex_entry_id', sa.Integer(), nullable=True),
        sa.Column('source_turn_id', sa.Integer(), sa.ForeignKey('dm_turns.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='open'),
        sa.Column('weight', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('dm_facts')
    op.drop_column('projects', 'campaign_brief')
