"""crate tracking: crates handed back with a payment, and a per-shop switch

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-21 11:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('payments', sa.Column('crates_in', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('shops', sa.Column('track_crates', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('shops', 'track_crates')
    op.drop_column('payments', 'crates_in')
