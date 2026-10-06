"""notifications.ticket_id, so a notification can open the request it is about

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-06 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ticket_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_notifications_ticket_id_tickets', 'tickets', ['ticket_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_constraint('fk_notifications_ticket_id_tickets', type_='foreignkey')
        batch_op.drop_column('ticket_id')
