"""Point d'entrée de l'API terrain Swiss Piscine (FastAPI)."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import settings
from .routers import attendance, auth, interventions, me, rh

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "company_id": settings.company_id}


app.include_router(auth.router)
app.include_router(me.router)
app.include_router(attendance.router)
app.include_router(interventions.router)
app.include_router(rh.router)
