"""per-shop choice of main calendar (BS or AD)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-19 21:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('shops', sa.Column('date_system', sa.String(length=2), nullable=False, server_default='bs'))


def downgrade() -> None:
    op.drop_column('shops', 'date_system')
