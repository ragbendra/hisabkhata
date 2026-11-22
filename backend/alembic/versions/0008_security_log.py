"""security events (sign-ins, device limit, exports) and flags for the platform admin

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-22 15:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'security_events',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('shop_id', sa.Uuid(), nullable=True),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('login', sa.String(200), nullable=True),
        sa.Column('ip', sa.String(64), nullable=True),
        sa.Column('user_agent', sa.String(300), nullable=True),
        sa.Column('detail', sa.String(300), nullable=True),
    )
    op.create_index('ix_security_events_at', 'security_events', ['at'])
    op.create_index('ix_security_events_shop_id', 'security_events', ['shop_id'])
    op.create_index('ix_security_events_user_id', 'security_events', ['user_id'])
    op.create_table(
        'security_flags',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('key', sa.String(200), nullable=False, unique=True),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('severity', sa.String(10), nullable=False, server_default='warning'),
        sa.Column('shop_id', sa.Uuid(), nullable=True),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('detail', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_security_flags_shop_id', 'security_flags', ['shop_id'])
    op.create_index('ix_security_flags_created_at', 'security_flags', ['created_at'])


def downgrade() -> None:
    op.drop_table('security_flags')
    op.drop_table('security_events')
