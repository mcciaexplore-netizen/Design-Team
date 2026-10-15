"""edit window default: 12 hours -> 2 days

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0010'
down_revision: Union[str, None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only the studio-wide default still at the old value; per-design-type overrides were chosen by a lead.
    op.execute("UPDATE system_settings SET edit_window_hours = 48 WHERE edit_window_hours = 12")


def downgrade() -> None:
    op.execute("UPDATE system_settings SET edit_window_hours = 12 WHERE edit_window_hours = 48")
