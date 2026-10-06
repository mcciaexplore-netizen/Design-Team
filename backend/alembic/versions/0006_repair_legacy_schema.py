"""Repair databases created before migrations existed (audit_logs.changed_by_id must allow NULL, missing indexes)

Actions by a person without an account (a client reviewing via a link, the public request form, Jira) are logged with
no user, so audit_logs.changed_by_id has to be nullable. Databases built by the old create_all() had it NOT NULL.
Every step checks the live schema first, so this does nothing on a database that is already correct.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-06 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if context.is_offline_mode():
        return  # needs to inspect a live database
    inspector = sa.inspect(op.get_bind())

    columns = {c['name']: c for c in inspector.get_columns('audit_logs')}
    if not columns['changed_by_id']['nullable']:
        with op.batch_alter_table('audit_logs', schema=None) as batch_op:
            batch_op.alter_column('changed_by_id', existing_type=sa.Integer(), nullable=True)

    for table, index in (('tickets', 'ix_tickets_client_org'), ('users', 'ix_users_client_org')):
        if index not in {i['name'] for i in inspector.get_indexes(table)}:
            op.create_index(index, table, ['client_org'], unique=False)


def downgrade() -> None:
    # A repair only; there is nothing to undo.
    pass
