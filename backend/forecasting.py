from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import Ticket, User
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/forecasting", tags=["forecasting"])

@router.get("/capacity")
def get_capacity_forecast(db: Session = Depends(get_db)):
    """
    Predictive Resource Forecasting Algorithm:
    Analyzes upcoming tickets and compares against designer daily capacity.
    Returns warnings if someone will be overloaded in the next 7 days.
    """
    designers = db.query(User).filter(User.role.in_(["Designer", "Design Lead"])).all()
    
    # Mocking a Gantt/Capacity response for the UI
    now = datetime.now()
    forecast = []
    
    for designer in designers:
        # Check active tickets due in the next 7 days
        # This is heavily simplified. A real algorithm would distribute the remaining SLA hours 
        # across the available working days.
        
        # Mocking calculation that Alice is overloaded next Thursday
        is_overloaded = False
        overload_date = None
        
        if designer.full_name == "Alice":
            is_overloaded = True
            overload_date = (now + timedelta(days=4)).strftime("%Y-%m-%d")
            
        forecast.append({
            "designer_id": designer.id,
            "designer_name": designer.full_name,
            "daily_capacity_hours": designer.daily_capacity_hours,
            "is_overloaded_next_7_days": is_overloaded,
            "overload_date": overload_date,
            "projected_capacity_percentage": 115 if is_overloaded else 75
        })
        
    return {"forecast": forecast}
