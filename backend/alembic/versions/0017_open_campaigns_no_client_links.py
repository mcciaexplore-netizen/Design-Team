"""Clients have no accounts: drop client sign-in links; campaigns and posts can be added without a user.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0017'
down_revision: Union[str, None] = '0016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('ix_client_link_tokens_expires_at', table_name='client_link_tokens')
    op.drop_index('ix_client_link_tokens_token_hash', table_name='client_link_tokens')
    op.drop_index('ix_client_link_tokens_user_id', table_name='client_link_tokens')
    op.drop_index('ix_client_link_tokens_id', table_name='client_link_tokens')
    op.drop_table('client_link_tokens')

    for table in ('campaigns', 'social_posts'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column('created_by_id', existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Rows added without a user can't satisfy NOT NULL again; they are removed first.
    op.execute("DELETE FROM social_posts WHERE created_by_id IS NULL")
    op.execute("DELETE FROM campaigns WHERE created_by_id IS NULL")
    for table in ('campaigns', 'social_posts'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column('created_by_id', existing_type=sa.Integer(), nullable=False)

    op.create_table(
        'client_link_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('purpose', sa.String(length=20), nullable=False, server_default='client'),
        sa.Column('ticket_id', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_client_link_tokens_id', 'client_link_tokens', ['id'], unique=False)
    op.create_index('ix_client_link_tokens_user_id', 'client_link_tokens', ['user_id'], unique=False)
    op.create_index('ix_client_link_tokens_token_hash', 'client_link_tokens', ['token_hash'], unique=True)
    op.create_index('ix_client_link_tokens_expires_at', 'client_link_tokens', ['expires_at'], unique=False)
