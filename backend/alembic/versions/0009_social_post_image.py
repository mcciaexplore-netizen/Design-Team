"""image uploaded with a social post

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('social_posts') as batch:
        batch.add_column(sa.Column('image_key', sa.String(), nullable=True))
        batch.add_column(sa.Column('image_name', sa.String(), nullable=True))
        batch.add_column(sa.Column('image_type', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('social_posts') as batch:
        batch.drop_column('image_type')
        batch.drop_column('image_name')
        batch.drop_column('image_key')
