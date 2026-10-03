from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from timetracking import compute_workload

router = APIRouter(prefix="/api/forecasting", tags=["forecasting"])


@router.get("/capacity")
def get_capacity_forecast(days: int = Query(default=7, ge=1, le=30), db: Session = Depends(get_db)):
    """Capacity forecast from real data: assigned open tickets' remaining effort vs. each designer's working-day capacity."""
    data = compute_workload(db, days)
    return {
        "forecast": [
            {
                "designer_id": d["designer_id"],
                "designer_name": d["designer_name"],
                "daily_capacity_hours": d["daily_capacity_hours"],
                "is_overloaded_next_7_days": d["is_overloaded"],
                "overload_date": d["overload_date"],
                "projected_capacity_percentage": d["utilization_pct"],
                "planned_hours": d["planned_hours"],
                "capacity_hours": d["capacity_hours"],
            }
            for d in data["designers"]
        ],
        "unassigned_hours": data["unassigned_hours"],
        "unassigned_tickets": data["unassigned_tickets"],
        "window": data["window"],
    }
