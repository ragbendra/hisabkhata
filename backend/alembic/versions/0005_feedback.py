"""feedback sent from inside the app

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-20 11:40:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'feedback',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('shop_id', sa.Uuid(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('message', sa.String(length=2000), nullable=False),
        sa.Column('contact', sa.String(length=200), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='new'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('handled_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_feedback_shop_id', 'feedback', ['shop_id'])
    op.create_index('ix_feedback_status', 'feedback', ['status', 'created_at'])


def downgrade() -> None:
    op.drop_table('feedback')
