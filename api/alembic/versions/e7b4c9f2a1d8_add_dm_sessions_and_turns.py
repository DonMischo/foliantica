"""add dm sessions and turns

Revision ID: e7b4c9f2a1d8
Revises: c3f8a2d91e5b
Create Date: 2026-07-18

"""
from alembic import op
import sqlalchemy as sa


revision = 'e7b4c9f2a1d8'
down_revision = 'c3f8a2d91e5b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('dm_prefs', sa.Text(), nullable=True))
    op.create_table(
        'dm_sessions',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), index=True),
        sa.Column('title', sa.String(length=255), nullable=False, server_default='Session'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        'dm_turns',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('dm_sessions.id', ondelete='CASCADE'), index=True),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False, server_default=''),
        sa.Column('rolls', sa.Text(), nullable=True),
        sa.Column('effects', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('dm_turns')
    op.drop_table('dm_sessions')
    op.drop_column('projects', 'dm_prefs')
