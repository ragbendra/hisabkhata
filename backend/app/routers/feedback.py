"""Feedback from inside the app: a shop owner or helper writes a question, problem or idea; the platform admin reads it."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import user_even_if_expired
from ..emailer import send_email
from ..models import Feedback, Shop, User
from ..ratelimit import limiter, too_many

log = logging.getLogger("hisab.feedback")
router = APIRouter(tags=["feedback"])


class FeedbackIn(BaseModel):
    kind: Literal["problem", "question", "idea"] = "problem"
    message: str = Field(min_length=5, max_length=2000)
    contact: str | None = Field(default=None, max_length=200)  # phone or email to reply to


@router.post("/feedback", status_code=201)
def send_feedback(
    body: FeedbackIn, request: Request, user: User = Depends(user_even_if_expired), db: Session = Depends(get_db)
):
    key = f"feedback:{user.id}"
    if limiter.blocked(key, 10, 3600):
        raise too_many("You have sent a lot of messages. Please try again in an hour.")
    limiter.add(key, 3600)
    shop = db.get(Shop, user.shop_id)
    fb = Feedback(
        shop_id=user.shop_id,
        user_id=user.id,
        kind=body.kind,
        message=body.message.strip(),
        contact=(body.contact or "").strip() or None,
    )
    db.add(fb)
    db.commit()
    if settings.admin_notify_email:
        try:
            send_email(
                settings.admin_notify_email,
                f"Hisab feedback ({body.kind}) from {shop.name}",
                f"{user.name} ({shop.name}) wrote:\n\n{fb.message}\n\nReply to: {fb.contact or '(none given)'}\n\n"
                f"Open {settings.app_base_url}/admin to mark it done.\n",
            )
        except Exception:  # saved already; a mail problem must not fail the form
            log.exception("could not email the feedback notice")
    return {"ok": True}
