"""tickets.external_key (linked Jira issue)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-06 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tickets', schema=None) as batch_op:
        batch_op.add_column(sa.Column('external_key', sa.String(), nullable=True))
        batch_op.create_index(batch_op.f('ix_tickets_external_key'), ['external_key'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('tickets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tickets_external_key'))
        batch_op.drop_column('external_key')
