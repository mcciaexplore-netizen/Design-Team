"""Revision Requested status, per-design-type edit window, shared rate-limit table

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-06 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL stores the status as a native enum, so the new value has to be added to the type.
    # SQLite keeps it as plain text, so nothing is needed there.
    if op.get_context().dialect.name == 'postgresql':
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE ticketstatus ADD VALUE IF NOT EXISTS 'REVISION_REQUESTED'")

    with op.batch_alter_table('design_types', schema=None) as batch_op:
        batch_op.add_column(sa.Column('edit_window_hours', sa.Integer(), nullable=True))

    op.create_table(
        'rate_limit_hits',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('rate_limit_hits', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_rate_limit_hits_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_rate_limit_hits_key'), ['key'], unique=False)
        batch_op.create_index(batch_op.f('ix_rate_limit_hits_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    # A native enum value can't be removed from PostgreSQL without recreating the type; it is left in place.
    with op.batch_alter_table('rate_limit_hits', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_rate_limit_hits_created_at'))
        batch_op.drop_index(batch_op.f('ix_rate_limit_hits_key'))
        batch_op.drop_index(batch_op.f('ix_rate_limit_hits_id'))
    op.drop_table('rate_limit_hits')

    with op.batch_alter_table('design_types', schema=None) as batch_op:
        batch_op.drop_column('edit_window_hours')
