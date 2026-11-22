from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import owner_only
from ..export import build_workbook
from ..models import User
from ..security_log import record

router = APIRouter(prefix="/export", tags=["export"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/full")
def export_full(request: Request, owner: User = Depends(owner_only), db: Session = Depends(get_db)):
    filename, data = build_workbook(db, owner.shop_id)
    record(db, "export_full", request, user=owner)
    db.commit()
    return Response(
        content=data,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
