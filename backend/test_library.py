import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, User, RoleEnum, CdrRequest, CdrRequestStatus, CdrDownloadLog
from cdr_engine import create_cdr_request, approve_cdr_request, upload_cdr, generate_download_link

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    requester = User(email="req@t.com", full_name="Req", hashed_password="pw", role=RoleEnum.REQUESTER)
    lead = User(email="lead@t.com", full_name="Lead", hashed_password="pw", role=RoleEnum.DESIGN_LEAD)
    db.add_all([requester, lead])
    db.commit()
    
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)

def test_cdr_lifecycle(db, monkeypatch):
    users = db.query(User).all()
    requester = users[0]
    lead = users[1]
    
    # 1. Request
    req = create_cdr_request(db, requester_id=requester.id, ticket_id=1)
    assert req.status == CdrRequestStatus.REQUESTED
    
    # 2. Approve
    req = approve_cdr_request(db, request_id=req.id, approver_id=lead.id)
    assert req.status == CdrRequestStatus.APPROVED
    
    # 3. Upload
    req = upload_cdr(db, request_id=req.id, s3_object_key="private/project-final.cdr", preview_url="https://preview.png")
    assert req.status == CdrRequestStatus.UPLOADED
    assert req.s3_object_key == "private/project-final.cdr"
    
    # Mock boto3 so it doesn't fail without real MinIO
    monkeypatch.setattr("boto3.client", lambda *args, **kwargs: None)
    class MockS3Client:
        def generate_presigned_url(self, action, Params, ExpiresIn):
            return f"https://mock-s3.com/{Params['Key']}?expires=3600"
            
    import cdr_engine
    cdr_engine.s3_client = MockS3Client()
    
    # 4. Download
    url = generate_download_link(db, request_id=req.id, user_id=requester.id)
    assert url == "https://mock-s3.com/private/project-final.cdr?expires=3600"
    
    # 5. Verify Audit Log
    logs = db.query(CdrDownloadLog).all()
    assert len(logs) == 1
    assert logs[0].user_id == requester.id
    assert logs[0].cdr_request_id == req.id
