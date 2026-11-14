import logging
import smtplib
from email.message import EmailMessage

from .config import settings

log = logging.getLogger("fruit_khata.email")


def send_email(to: str, subject: str, body: str, attachments: list[tuple[str, bytes, str]] | None = None) -> None:
    """Send via SMTP. With no FK_SMTP_HOST configured the message is logged (development)."""
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    for filename, data, mimetype in attachments or []:
        maintype, _, subtype = mimetype.partition("/")
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)

    if not settings.smtp_host:
        log.warning("SMTP not configured; email to %s not sent. Subject: %s\n%s", to, subject, body)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as s:
        s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)
