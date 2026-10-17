"""library_item_versions: original file name, type, size and a note per version

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-17 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: Union[str, None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('library_item_versions') as batch:
        batch.add_column(sa.Column('file_name', sa.String(), nullable=True))
        batch.add_column(sa.Column('content_type', sa.String(), nullable=True))
        batch.add_column(sa.Column('size_bytes', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('note', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('library_item_versions') as batch:
        batch.drop_column('note')
        batch.drop_column('size_bytes')
        batch.drop_column('content_type')
        batch.drop_column('file_name')
