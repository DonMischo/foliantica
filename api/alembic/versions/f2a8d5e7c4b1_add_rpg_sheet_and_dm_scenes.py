"""add rpg_sheet and dm_scenes

Revision ID: f2a8d5e7c4b1
Revises: e7b4c9f2a1d8
Create Date: 2026-07-18

"""
from alembic import op
import sqlalchemy as sa


revision = 'f2a8d5e7c4b1'
down_revision = 'e7b4c9f2a1d8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('codex_entries', sa.Column('rpg_sheet', sa.Text(), nullable=True))
    op.create_table(
        'dm_scenes',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), index=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('dm_sessions.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('title', sa.String(length=255), nullable=False, server_default='Scene'),
        sa.Column('location_entry_id', sa.Integer(), nullable=True),
        sa.Column('present_npcs', sa.Text(), nullable=True),
        sa.Column('situation', sa.Text(), nullable=True),
        sa.Column('is_current', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('dm_scenes')
    op.drop_column('codex_entries', 'rpg_sheet')
