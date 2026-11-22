"""signed-in devices (last seen, browser, address), one owner per shop

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-22 12:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # the unique index would fail with an unhelpful message if a shop already has two owners
    dup = bind.execute(sa.text("SELECT shop_id, COUNT(*) FROM users WHERE role = 'owner' GROUP BY shop_id HAVING COUNT(*) > 1")).fetchall()
    if dup:
        raise RuntimeError(
            "These shops have more than one owner login: " + ", ".join(str(r[0]) for r in dup)
            + ". Make all but one of them a helper (users.role = 'helper'), then run the migration again."
        )

    op.add_column('sessions', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('sessions', sa.Column('user_agent', sa.String(300), nullable=True))
    op.add_column('sessions', sa.Column('ip', sa.String(64), nullable=True))
    op.execute("UPDATE sessions SET last_seen_at = created_at")

    # at most 3 devices per login: keep each user's 3 newest sessions
    sessions = sa.table('sessions', sa.column('id', sa.Uuid()), sa.column('user_id', sa.Uuid()), sa.column('created_at', sa.DateTime(timezone=True)))
    rows = bind.execute(sa.select(sessions.c.id, sessions.c.user_id).order_by(sessions.c.user_id, sessions.c.created_at.desc())).fetchall()
    seen: dict = {}
    drop = []
    for sid, uid in rows:
        seen[uid] = seen.get(uid, 0) + 1
        if seen[uid] > 3:
            drop.append(sid)
    for sid in drop:
        bind.execute(sa.delete(sessions).where(sessions.c.id == sid))

    op.create_index(
        'uq_one_owner_per_shop', 'users', ['shop_id'], unique=True,
        postgresql_where=sa.text("role = 'owner'"), sqlite_where=sa.text("role = 'owner'"),
    )


def downgrade() -> None:
    op.drop_index('uq_one_owner_per_shop', table_name='users')
    op.drop_column('sessions', 'ip')
    op.drop_column('sessions', 'user_agent')
    op.drop_column('sessions', 'last_seen_at')
