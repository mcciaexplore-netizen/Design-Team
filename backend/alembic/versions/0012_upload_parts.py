"""upload_parts: large files sent in pieces, joined when the form is submitted

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012'
down_revision: Union[str, None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'upload_parts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('upload_id', sa.String(length=32), nullable=False),
        sa.Column('part', sa.Integer(), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    )
    op.create_index('ix_upload_parts_upload_id', 'upload_parts', ['upload_id'])
    op.create_index('ix_upload_parts_created_at', 'upload_parts', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_upload_parts_created_at', table_name='upload_parts')
    op.drop_index('ix_upload_parts_upload_id', table_name='upload_parts')
    op.drop_table('upload_parts')
