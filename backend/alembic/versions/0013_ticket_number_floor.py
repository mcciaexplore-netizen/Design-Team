"""system_settings.ticket_number_floor: numbering carries on after all past data is deleted

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-17 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013'
down_revision: Union[str, None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('system_settings') as batch:
        batch.add_column(sa.Column('ticket_number_floor', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('system_settings') as batch:
        batch.drop_column('ticket_number_floor')
