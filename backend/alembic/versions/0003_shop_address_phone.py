"""shop address and phone, printed on PDF bills and statements

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-19 11:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('shops', sa.Column('address', sa.String(length=300), nullable=True))
    op.add_column('shops', sa.Column('phone', sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column('shops', 'phone')
    op.drop_column('shops', 'address')
