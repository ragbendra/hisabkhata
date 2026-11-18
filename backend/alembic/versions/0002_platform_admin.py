"""platform admin, invites, shop subscription

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-17 20:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing shops stay active with no end date, so nothing changes for the current client.
    op.add_column('shops', sa.Column('status', sa.String(length=10), nullable=False, server_default='active'))
    op.add_column('shops', sa.Column('access_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('shops', sa.Column('admin_notes', sa.String(length=1000), nullable=True))
    op.add_column('shops', sa.Column('created_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table('platform_admins',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('password_hash', sa.String(length=300), nullable=False),
    sa.Column('totp_secret', sa.String(length=64), nullable=True),
    sa.Column('totp_pending', sa.String(length=64), nullable=True),
    sa.Column('disabled_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('admin_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('admin_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['admin_id'], ['platform_admins.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index(op.f('ix_admin_sessions_admin_id'), 'admin_sessions', ['admin_id'], unique=False)
    op.create_table('platform_settings',
    sa.Column('key', sa.String(length=40), nullable=False),
    sa.Column('value', sa.String(length=200), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('access_requests',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('shop_name', sa.String(length=200), nullable=False),
    sa.Column('owner_name', sa.String(length=120), nullable=False),
    sa.Column('contact', sa.String(length=200), nullable=False),
    sa.Column('city', sa.String(length=120), nullable=True),
    sa.Column('message', sa.String(length=500), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('handled_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_access_requests_status', 'access_requests', ['status', 'created_at'], unique=False)
    op.create_table('invites',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('email', sa.String(length=200), nullable=True),
    sa.Column('shop_name', sa.String(length=200), nullable=True),
    sa.Column('owner_name', sa.String(length=120), nullable=True),
    sa.Column('trial_days', sa.Integer(), nullable=False),
    sa.Column('request_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('shop_id', sa.Uuid(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_table('subscription_payments',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('shop_id', sa.Uuid(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('mode', sa.String(length=10), nullable=False),
    sa.Column('paid_on', sa.Date(), nullable=False),
    sa.Column('extended_to', sa.DateTime(timezone=True), nullable=True),
    sa.Column('note', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['shop_id'], ['shops.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscription_payments_shop_id'), 'subscription_payments', ['shop_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_subscription_payments_shop_id'), table_name='subscription_payments')
    op.drop_table('subscription_payments')
    op.drop_table('invites')
    op.drop_index('ix_access_requests_status', table_name='access_requests')
    op.drop_table('access_requests')
    op.drop_table('platform_settings')
    op.drop_index(op.f('ix_admin_sessions_admin_id'), table_name='admin_sessions')
    op.drop_table('admin_sessions')
    op.drop_table('platform_admins')
    op.drop_column('shops', 'created_at')
    op.drop_column('shops', 'admin_notes')
    op.drop_column('shops', 'access_until')
    op.drop_column('shops', 'status')
