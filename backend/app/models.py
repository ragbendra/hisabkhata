"""Data model (requirements section 6). Primary keys are UUIDs created by the phone that creates the record.

Two small additions beyond section 6, needed by FR-1: `sessions` and `password_resets`.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    TypeDecorator,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .timeutil import UTC, utcnow


class UTCDateTime(TypeDecorator):
    """Always timezone-aware UTC, also on SQLite (used in tests) which drops tzinfo."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


Money = Numeric(14, 2)
UUIDPK = Uuid(as_uuid=True)


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUIDPK, primary_key=True, default=uuid.uuid4)


class Shop(Base):
    __tablename__ = "shops"
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(200))
    next_bill_no: Mapped[int] = mapped_column(Integer, default=1)
    backup_email_day: Mapped[int] = mapped_column(Integer, default=0)  # 0=Sunday .. 6=Saturday
    backup_email_time: Mapped[str] = mapped_column(String(5), default="20:00")  # Nepal time HH:MM
    last_weekly_email_on: Mapped[date | None] = mapped_column(Date, nullable=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    login: Mapped[str] = mapped_column(String(200), unique=True)  # owner: email, helper: short name
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(10))  # owner | helper
    disabled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class UserSession(Base):
    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[uuid.UUID] = pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id"))
    name: Mapped[str] = mapped_column(String(200))
    other_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    next_collection_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(UUIDPK, nullable=True)
    possible_duplicate_of: Mapped[uuid.UUID | None] = mapped_column(UUIDPK, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (Index("ix_customers_shop_name", "shop_id", "name"),)


class Opening(Base):
    __tablename__ = "openings"
    id: Mapped[uuid.UUID] = pk()
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Money)  # may be negative (customer already paid ahead)
    as_of_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUIDPK, nullable=True)


class FruitName(Base):
    __tablename__ = "fruit_names"
    id: Mapped[uuid.UUID] = pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    last_rate: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Sale(Base):
    __tablename__ = "sales"
    id: Mapped[uuid.UUID] = pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"))
    bill_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    bill_date: Mapped[date] = mapped_column(Date)
    total: Mapped[Decimal] = mapped_column(Money)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_by: Mapped[uuid.UUID] = mapped_column(UUIDPK)
    server_received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    voided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)

    lines: Mapped[list["SaleLine"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", order_by="SaleLine.position"
    )

    __table_args__ = (Index("ix_sales_shop_customer_date", "shop_id", "customer_id", "bill_date"),)


class SaleLine(Base):
    __tablename__ = "sale_lines"
    id: Mapped[uuid.UUID] = pk()
    sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sales.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    fruit_name: Mapped[str] = mapped_column(String(120))
    crates: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kg: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    rate: Mapped[Decimal] = mapped_column(Money)
    amount: Mapped[Decimal] = mapped_column(Money)

    sale: Mapped[Sale] = relationship(back_populates="lines")


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[uuid.UUID] = pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"))
    kind: Mapped[str] = mapped_column(String(10), default="payment")  # payment | discount
    amount: Mapped[Decimal] = mapped_column(Money)
    mode: Mapped[str] = mapped_column(String(10), default="cash")  # cash|esewa|khalti|bank|other
    paid_at: Mapped[datetime] = mapped_column(UTCDateTime)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_by: Mapped[uuid.UUID] = mapped_column(UUIDPK)
    server_received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    voided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)

    __table_args__ = (Index("ix_payments_shop_customer_paid", "shop_id", "customer_id", "paid_at"),)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[uuid.UUID] = pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(UUIDPK, index=True)
    entity: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[uuid.UUID] = mapped_column(UUIDPK, index=True)
    action: Mapped[str] = mapped_column(String(30))  # edit | void | undo | merge | archive | ...
    before_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUIDPK, nullable=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class BackupRun(Base):
    __tablename__ = "backup_runs"
    id: Mapped[uuid.UUID] = pk()
    kind: Mapped[str] = mapped_column(String(10))  # database | off-site | email
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
