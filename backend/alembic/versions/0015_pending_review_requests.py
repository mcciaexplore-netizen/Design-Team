"""Pending Review / Declined ticket statuses, so a Design Lead can accept or decline a client's request

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0015'
down_revision: Union[str, None] = '0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL stores the status as a native enum, so the new values have to be added to the type.
    # SQLite keeps it as plain text, so nothing is needed there.
    if op.get_context().dialect.name == 'postgresql':
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE ticketstatus ADD VALUE IF NOT EXISTS 'PENDING_REVIEW'")
            op.execute("ALTER TYPE ticketstatus ADD VALUE IF NOT EXISTS 'DECLINED'")

    with op.batch_alter_table('tickets', schema=None) as batch_op:
        batch_op.add_column(sa.Column('decline_reason', sa.Text(), nullable=True))


def downgrade() -> None:
    # Native enum values can't be removed from PostgreSQL without recreating the type; they are left in place.
    with op.batch_alter_table('tickets', schema=None) as batch_op:
        batch_op.drop_column('decline_reason')
