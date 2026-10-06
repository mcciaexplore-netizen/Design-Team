"""Banner design type: drop the required "Banner Size" field

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SIZE_FIELD = {"name": "size", "label": "Banner Size (e.g., 1024x768)", "type": "string"}

design_types = sa.table('design_types', sa.column('name', sa.String), sa.column('required_fields', sa.JSON))


def _set(transform) -> None:
    if context.is_offline_mode():
        return  # data fix-up needs a live database; `alembic upgrade` online applies it
    conn = op.get_bind()
    for name, fields in conn.execute(sa.select(design_types.c.name, design_types.c.required_fields)).all():
        if name == 'Banner':
            conn.execute(design_types.update().where(design_types.c.name == 'Banner').values(required_fields=transform(list(fields or []))))


def upgrade() -> None:
    _set(lambda fields: [f for f in fields if f.get("name") != "size"])


def downgrade() -> None:
    _set(lambda fields: fields if any(f.get("name") == "size" for f in fields) else [SIZE_FIELD, *fields])
