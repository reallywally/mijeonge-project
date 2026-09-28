from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, meeting, project, task, thread
from app.config import settings

app = FastAPI(title="innoFlow API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(project.router, prefix="/api")
app.include_router(task.router, prefix="/api")
app.include_router(thread.router, prefix="/api")
app.include_router(meeting.router, prefix="/api")
