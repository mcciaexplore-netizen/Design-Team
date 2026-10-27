"""Short-lived, single-use tokens for passwordless client access and email confirmation.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0016'
down_revision: Union[str, None] = '0015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash')
    )
    op.create_index('ix_client_link_tokens_user_id', 'client_link_tokens', ['user_id'], unique=False)
    op.create_index('ix_client_link_tokens_token_hash', 'client_link_tokens', ['token_hash'], unique=False)
    op.create_index('ix_client_link_tokens_expires_at', 'client_link_tokens', ['expires_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_client_link_tokens_expires_at', table_name='client_link_tokens')
    op.drop_index('ix_client_link_tokens_token_hash', table_name='client_link_tokens')
    op.drop_index('ix_client_link_tokens_user_id', table_name='client_link_tokens')
    op.drop_table('client_link_tokens')
