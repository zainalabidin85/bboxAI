import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id           = Column(String(36), primary_key=True, default=_uuid)
    username     = Column(String(50),  unique=True, nullable=False, index=True)
    email        = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)
    is_active    = Column(Boolean, default=True)

    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id         = Column(String(12),  primary_key=True)
    name       = Column(String(255), nullable=False)
    owner_id   = Column(String(36),  ForeignKey("users.id"), nullable=False)
    is_public  = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner          = relationship("User", back_populates="projects")
    classes        = relationship("BboxClass", back_populates="project",
                                  order_by="BboxClass.class_index",
                                  cascade="all, delete-orphan")
    trained_models = relationship("TrainedModel", back_populates="project",
                                  cascade="all, delete-orphan")
    uploads        = relationship("Upload", back_populates="project",
                                  cascade="all, delete-orphan")


class BboxClass(Base):
    __tablename__ = "classes"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    project_id  = Column(String(12), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name        = Column(String(100), nullable=False)
    class_index = Column(Integer, nullable=False)

    project = relationship("Project", back_populates="classes")


class Upload(Base):
    __tablename__ = "uploads"

    id         = Column(String(32), primary_key=True)
    project_id = Column(String(12), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id    = Column(String(36), ForeignKey("users.id"), nullable=True)
    filename   = Column(String(255))
    box_count  = Column(Integer, default=0)
    notes      = Column(Text, default="")
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="uploads")


class TrainedModel(Base):
    __tablename__ = "trained_models"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String(12), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    base_model = Column(String(100))
    epochs     = Column(Integer)
    imgsz      = Column(Integer)
    map50      = Column(Float)
    map50_95   = Column(Float)
    precision  = Column(Float)
    recall     = Column(Float)
    trained_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="trained_models")
