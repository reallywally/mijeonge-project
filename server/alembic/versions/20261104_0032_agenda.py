"""안건 간소화 — thread → agenda, 제목 · 설명 · 결정내용 · 상태

Revision ID: 0032_agenda
Revises: 0031_decision_item
Create Date: 2026-11-04

계약은 `docs/api/agenda.md` '이행' 1 ~ 8. 순서도 그대로다.

1. `thread.decision` · `decided_at` · `decision_rev` 를 더한다
2. 결정내용 — 지우지 않은 항목마다 지금 유효한 결정(세부 · 그 뒤의 refine 은 `- ` 줄)
3. `decided_at` · `decision_rev`
4. `check_request` 의 `entry_id` → `decision_rev` · `decision`
5. 테스트 `basis_seq` — 결정 바뀜이 이제 `agenda_history` 에만 남는다.
   지운 줄이 아닌 decide · change 가 있던 안건마다 '결정내용' 줄 하나(backfilled)를
   그 안건의 마지막 결정 줄 seq 순으로 넣고, 테스트마다 옛 규칙으로 바뀜이 없던 안건의
   새 줄까지를 basis 로 둔다 — 바뀜이 있던 테스트는 계속 있고 없던 테스트는 계속 없다
   (줄 순서가 옛 seq 순서와 같아서 하나의 basis 로 가를 수 있다)
6. 후보 · 참조 · 결정 항목 · 이력 줄 · 상위 안건 · 미룸 문턱을 지운다
7. 이름 바꾸기 — 테이블 · 컬럼 · 인덱스 · 제약 · 시퀀스, 이력 JSON 의 칸 이름 · 저장한 리포트의 키
8. downgrade 는 이름 · 칸만 되돌린다 — **지운 이력 줄 · 항목 · 후보 · 참조는 되살리지 못한다**
   (빈 표로 다시 세운다). 확인 요청은 가리킬 이력 줄이 없어 지운다
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0032_agenda"
down_revision: str | None = "0031_decision_item"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
CHANGES = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
LIVE = sa.text("not is_deleted")
DECIDING = ("decide", "change")
ENTRY_KINDS = ("raise", "defer", "decide", "refine", "change", "split")

TABLES = [
    ("thread", "agenda"),
    ("thread_history", "agenda_history"),
    ("task_thread_link", "task_agenda_link"),
]
# 표 이름을 바꾼 뒤의 이름으로 적는다
COLUMNS = [
    ("agenda_history", "thread_id", "agenda_id"),
    ("task_agenda_link", "thread_id", "agenda_id"),
    ("check_request", "thread_id", "agenda_id"),
    ("check_request", "load_open_threads", "load_open_agendas"),
    ("test_ref", "thread_id", "agenda_id"),
]
CHECK_UNIQUE = "uq_check_request_agenda_id_decision_rev_recipient_id"
# 이력 JSON 의 칸 이름 — 작업의 안건 링크 · 테스트의 안건 태그
HISTORY_FIELDS = [("task_history", "thread", "agenda"), ("test_history", "threadRef", "agendaRef")]
# 저장한 리포트(facts)의 키
REPORT_KEYS = [
    ("decidedThreadIds", "decidedAgendaIds"),
    ("deferredThreadIds", "deferredAgendaIds"),
    ("riskyThreadIds", "riskyAgendaIds"),
]
REPORT_WEIGHT_KEYS = [("threadCount", "agendaCount")]


def _t(name: str, *columns: sa.Column[Any]) -> sa.TableClause:
    # 열 타입을 적어 읽는다 — sqlite(검사)에서도 시각이 datetime, JSON 이 list 로 온다
    return sa.table(name, *columns)


def upgrade() -> None:
    bind = op.get_bind()
    # 1
    op.add_column("thread", sa.Column("decision", sa.Text(), server_default="", nullable=False))
    op.add_column("thread", sa.Column("decided_at", UTC_TS, nullable=True))
    op.add_column(
        "thread",
        sa.Column("decision_rev", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    with op.batch_alter_table("check_request") as batch:
        batch.add_column(sa.Column("decision_rev", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("decision", sa.Text(), nullable=True))

    # 2 ~ 5
    _fill(bind)

    # 4 — 구조
    with op.batch_alter_table("check_request") as batch:
        batch.alter_column("decision_rev", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("decision", existing_type=sa.Text(), nullable=False)
        batch.drop_constraint("uq_check_request_entry_id_recipient_id", type_="unique")
        batch.drop_constraint("fk_check_request_entry_id", type_="foreignkey")
        batch.drop_column("entry_id")

    # 6
    op.drop_index("ix_entry_detail_text_trgm", table_name="entry_detail")
    op.drop_table("entry_detail")
    for name in (
        "ix_entry_item_id",
        "ix_entry_minutes_id",
        "ix_entry_note_trgm",
        "ix_entry_text_trgm",
        "ix_entry_thread_id_created_at",
    ):
        op.drop_index(name, table_name="entry")
    op.drop_table("entry")
    op.drop_index("ix_decision_item_title_trgm", table_name="decision_item")
    op.drop_index("ix_decision_item_thread_id_live", table_name="decision_item")
    op.drop_table("decision_item")
    op.drop_index("ix_thread_option_text_trgm", table_name="thread_option")
    op.drop_table("thread_option")
    op.drop_table("thread_cc")
    with op.batch_alter_table("thread") as batch:
        batch.drop_constraint("fk_thread_parent_thread_id", type_="foreignkey")
        batch.drop_column("parent_thread_id")
    with op.batch_alter_table("risk_setting") as batch:
        batch.drop_constraint(op.f("ck_risk_setting_defer_count_range"), type_="check")
        batch.drop_column("defer_count")

    # 7
    _rename(bind, forward=True)
    with op.batch_alter_table("check_request") as batch:
        batch.create_unique_constraint(CHECK_UNIQUE, ["agenda_id", "decision_rev", "recipient_id"])
    op.create_index(
        "ix_agenda_decision_trgm",
        "agenda",
        ["decision"],
        postgresql_using="gin",
        postgresql_ops={"decision": "gin_trgm_ops"},
    )
    _rename_json(bind, forward=True)


# --- 2 ~ 5 : 옛 이력에서 결정내용 · 결정 판 · 확인 요청 · 테스트 기준 ---


class _Entry:
    __slots__ = ("created_at", "creator_id", "detail", "id", "item_id", "kind", "seq", "text")

    def __init__(self, row: Any) -> None:
        self.id: str = row.id
        self.item_id: str | None = row.item_id
        self.kind: str = row.kind
        self.text: str = row.text
        self.creator_id: str | None = row.creator_id
        self.created_at: datetime = row.created_at
        self.seq: int = row.seq
        self.detail: list[str] = []


def _decision_of(title: str, items: list[Any], entries: list[_Entry]) -> tuple[str, list[_Entry]]:
    """(결정내용, 쓴 결정 줄). 규칙은 docs/api/agenda.md '이행' 2."""
    blocks: list[str] = []
    used: list[_Entry] = []
    for item in items:
        mine = [e for e in entries if e.item_id == item.id]
        deciding = [e for e in mine if e.kind in DECIDING]
        if not deciding:
            continue
        latest = max(deciding, key=lambda e: e.seq)
        used.append(latest)
        alone = len(items) == 1 and item.title.strip() == title.strip()
        lines = [latest.text if alone else f"{item.title}: {latest.text}"]
        lines += [f"- {text}" for text in latest.detail]
        for refine in sorted(
            (e for e in mine if e.kind == "refine" and e.seq > latest.seq), key=lambda e: e.seq
        ):
            lines.append(f"- {refine.text}")
            lines += [f"- {text}" for text in refine.detail]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks), used


def _fill(bind: sa.Connection) -> None:
    thread = _t(
        "thread",
        sa.column("id", ID),
        sa.column("project_id", ID),
        sa.column("title", sa.Text()),
        sa.column("state", sa.String(16)),
        sa.column("created_at", UTC_TS),
        sa.column("decision", sa.Text()),
        sa.column("decided_at", UTC_TS),
        sa.column("decision_rev", sa.Integer()),
        sa.column("is_deleted", sa.Boolean()),
    )
    entry = _t(
        "entry",
        sa.column("id", ID),
        sa.column("thread_id", ID),
        sa.column("item_id", ID),
        sa.column("kind", sa.String(16)),
        sa.column("text", sa.Text()),
        sa.column("creator_id", ID),
        sa.column("created_at", UTC_TS),
        sa.column("seq", sa.BigInteger()),
        sa.column("is_deleted", sa.Boolean()),
    )
    detail = _t(
        "entry_detail",
        sa.column("entry_id", ID),
        sa.column("text", sa.Text()),
        sa.column("sort_order", sa.Integer()),
    )
    item = _t(
        "decision_item",
        sa.column("id", ID),
        sa.column("thread_id", ID),
        sa.column("title", sa.Text()),
        sa.column("sort_order", sa.Integer()),
        sa.column("seq", sa.BigInteger()),
        sa.column("is_deleted", sa.Boolean()),
    )
    check = _t(
        "check_request",
        sa.column("id", ID),
        sa.column("thread_id", ID),
        sa.column("entry_id", ID),
        sa.column("decision_rev", sa.Integer()),
        sa.column("decision", sa.Text()),
    )

    # 지운 줄은 어디에도 안 든다 — 옛 상태 · 결정 · 테스트 기준도 지운 줄을 세지 않았다
    entries: dict[str, list[_Entry]] = defaultdict(list)
    by_id: dict[str, _Entry] = {}
    for row in bind.execute(
        sa.select(entry).where(entry.c.is_deleted.is_(False)).order_by(entry.c.seq)
    ):
        found = _Entry(row)
        entries[row.thread_id].append(found)
        by_id[found.id] = found
    for row in bind.execute(sa.select(detail).order_by(detail.c.entry_id, detail.c.sort_order)):
        if row.entry_id in by_id:
            by_id[row.entry_id].detail.append(row.text)
    items: dict[str, list[Any]] = defaultdict(list)
    for row in bind.execute(
        sa.select(item)
        .where(item.c.is_deleted.is_(False))
        .order_by(item.c.thread_id, item.c.sort_order, item.c.seq)
    ):
        items[row.thread_id].append(row)
    # 확인 요청이 가리킨 결정 줄 — 지운 줄도 요청은 남아 있었다(cascade 는 하드 삭제만)
    sent: dict[str, set[str]] = defaultdict(set)
    for row in bind.execute(sa.select(check.c.thread_id, check.c.entry_id)):
        sent[row.thread_id].add(row.entry_id)
    entry_seq = {
        row.id: (row.seq, row.text)
        for row in bind.execute(
            sa.select(entry.c.id, entry.c.seq, entry.c.text).where(
                entry.c.id.in_({i for ids in sent.values() for i in ids})
            )
        )
    }

    backfill: list[tuple[int, str, str, datetime, str | None]] = []
    for row in bind.execute(sa.select(thread)).all():
        mine = entries.get(row.id, [])
        decision, used = _decision_of(row.title, items.get(row.id, []), mine)
        decided_at: datetime | None = None
        if row.state == "decided":
            # 결정 줄이 없는 결정(항목을 지운 경우)은 등록 시각으로 — decided 면 늘 시각이 있다
            decided_at = max((e.created_at for e in used), default=row.created_at)
        rev = max(len(sent.get(row.id, ())), 1 if decision else 0)
        bind.execute(
            sa.update(thread)
            .where(thread.c.id == row.id)
            .values(decision=decision, decided_at=decided_at, decision_rev=rev)
        )
        # 4 — 안건마다 가리킨 줄을 그 줄의 seq 순으로 1, 2, …
        ordered = sorted(sent.get(row.id, ()), key=lambda i: entry_seq[i][0])
        for number, entry_id in enumerate(ordered, start=1):
            bind.execute(
                sa.update(check)
                .where(check.c.entry_id == entry_id)
                .values(decision_rev=number, decision=entry_seq[entry_id][1])
            )
        # 5 — 결정이 바뀐 적이 있는 안건(지우지 않은 decide · change). 지운 안건은 테스트가
        # 닿지 않고 이력도 안 나가니 줄을 만들지 않는다
        deciding = [e for e in mine if e.kind in DECIDING]
        if deciding and not row.is_deleted:
            last = max(deciding, key=lambda e: e.seq)
            source = max(used, key=lambda e: (e.created_at, e.seq)) if used else last
            backfill.append(
                (last.seq, row.id, row.project_id, source.created_at, source.creator_id)
            )
    _backfill_history(bind, backfill)


def _backfill_history(
    bind: sa.Connection, rows: list[tuple[int, str, str, datetime, str | None]]
) -> None:
    history = _t(
        "thread_history",
        sa.column("id", ID),
        sa.column("project_id", ID),
        sa.column("thread_id", ID),
        sa.column("changed_by", ID),
        sa.column("changed_at", UTC_TS),
        sa.column("seq", sa.BigInteger()),
        sa.column("changes", CHANGES),
        sa.column("backfilled", sa.Boolean()),
    )
    thread = _t("thread", sa.column("id", ID), sa.column("decision", sa.Text()))
    decision_of = dict(bind.execute(sa.select(thread.c.id, thread.c.decision)).tuples().all())
    top = bind.execute(sa.select(sa.func.max(history.c.seq))).scalar() or 0
    # 옛 마지막 결정 줄의 seq 순 — 테스트 basis 하나로 '그 뒤에 바뀐 안건' 을 가를 수 있게
    new_seq: dict[str, int] = {}
    for number, (_, thread_id, project_id, at, by) in enumerate(sorted(rows), start=top + 1):
        new_seq[thread_id] = number
        bind.execute(
            sa.insert(history).values(
                id=uuid4().hex,
                project_id=project_id,
                thread_id=thread_id,
                changed_by=by,
                changed_at=at,
                # 번호를 직접 준다 — sqlite 는 Identity 를 모른다. Postgres 는 아래서 시퀀스를 민다
                seq=number,
                changes=[
                    {
                        "field": "decision",
                        "from": "",
                        "to": decision_of[thread_id],
                        "subject": "",
                    }
                ],
                backfilled=True,
            )
        )
    if bind.dialect.name == "postgresql":
        op.execute(
            "select setval(pg_get_serial_sequence('thread_history', 'seq'),"
            " coalesce((select max(seq) from thread_history), 1),"
            " (select count(*) from thread_history) > 0)"
        )
    old_last = {thread_id: last for last, thread_id, *_ in rows}
    _rebase_tests(bind, new_seq, old_last)


def _rebase_tests(bind: sa.Connection, new_seq: dict[str, int], old_last: dict[str, int]) -> None:
    """테스트마다 basis 를 새 줄 기준으로 — 옛 규칙의 바뀜 있음 · 없음을 그대로 둔다."""
    test = _t("test_case", sa.column("id", ID), sa.column("basis_seq", sa.BigInteger()))
    ref = _t(
        "test_ref", sa.column("test_id", ID), sa.column("task_id", ID), sa.column("thread_id", ID)
    )
    task = _t("task", sa.column("id", ID), sa.column("is_deleted", sa.Boolean()))
    thread = _t("thread", sa.column("id", ID), sa.column("is_deleted", sa.Boolean()))
    link = _t("task_thread_link", sa.column("task_id", ID), sa.column("thread_id", ID))
    live_tasks = set(
        bind.execute(sa.select(task.c.id).where(task.c.is_deleted.is_(False))).scalars()
    )
    live_threads = set(
        bind.execute(sa.select(thread.c.id).where(thread.c.is_deleted.is_(False))).scalars()
    )
    links: dict[str, set[str]] = defaultdict(set)
    for task_id, thread_id in bind.execute(sa.select(link.c.task_id, link.c.thread_id)).tuples():
        if thread_id in live_threads:
            links[task_id].add(thread_id)
    reached: dict[str, set[str]] = defaultdict(set)
    for test_id, task_id, thread_id in bind.execute(sa.select(ref)).tuples():
        if thread_id is not None and thread_id in live_threads:
            reached[test_id].add(thread_id)
        if task_id is not None and task_id in live_tasks:
            reached[test_id] |= links.get(task_id, set())
    for test_id, basis in bind.execute(sa.select(test.c.id, test.c.basis_seq)).tuples().all():
        floor = basis or 0
        touched = [t for t in reached.get(test_id, set()) if t in new_seq]
        changed = any(old_last[t] > floor for t in touched)
        kept = [new_seq[t] for t in touched if old_last[t] <= floor]
        rebased = max(kept) if kept else (0 if changed else None)
        bind.execute(sa.update(test).where(test.c.id == test_id).values(basis_seq=rebased))


# --- 7 : 이름 ---


def _swap(name: str, forward: bool) -> str:
    return name.replace("thread", "agenda") if forward else name.replace("agenda", "thread")


def _rename(bind: sa.Connection, *, forward: bool) -> None:
    """표 → 컬럼 순으로 바꾸고, 되돌릴 때는 거꾸로. COLUMNS 는 새 표 이름으로 적혀 있다."""
    if forward:
        for old, new in TABLES:
            op.rename_table(old, new)
        for table, old, new in COLUMNS:
            op.execute(f"ALTER TABLE {table} RENAME COLUMN {old} TO {new}")
    else:
        for table, old, new in reversed(COLUMNS):
            op.execute(f"ALTER TABLE {table} RENAME COLUMN {new} TO {old}")
        for old, new in reversed(TABLES):
            op.rename_table(new, old)
    if bind.dialect.name == "postgresql":
        _rename_pg_names(bind, forward)
    else:
        _rename_sqlite_names(bind, forward)


def _rename_pg_names(bind: sa.Connection, forward: bool) -> None:
    old = "thread" if forward else "agenda"
    constraints = bind.execute(
        sa.text(
            "select conrelid::regclass::text, conname from pg_constraint"
            " where connamespace = current_schema()::regnamespace and conname like :p"
        ),
        {"p": f"%{old}%"},
    ).all()
    for table, name in constraints:
        op.execute(f'ALTER TABLE {table} RENAME CONSTRAINT "{name}" TO "{_swap(name, forward)}"')
    # 제약에 딸린 인덱스는 위에서 같이 바뀌었다 — 남은 것만
    indexes = bind.execute(
        sa.text(
            "select indexname from pg_indexes"
            " where schemaname = current_schema() and indexname like :p"
        ),
        {"p": f"%{old}%"},
    ).scalars()
    for name in list(indexes):
        op.execute(f'ALTER INDEX "{name}" RENAME TO "{_swap(name, forward)}"')
    sequences = bind.execute(
        sa.text(
            "select relname from pg_class where relkind = 'S'"
            " and relnamespace = current_schema()::regnamespace and relname like :p"
        ),
        {"p": f"%{old}%"},
    ).scalars()
    for name in list(sequences):
        op.execute(f'ALTER SEQUENCE "{name}" RENAME TO "{_swap(name, forward)}"')


def _rename_sqlite_names(bind: sa.Connection, forward: bool) -> None:
    """sqlite(검사) — 인덱스는 이름을 못 바꿔 지우고 다시 만든다. 유니크는 표를 새로 세운다."""
    old = "thread" if forward else "agenda"
    indexes = bind.execute(
        sa.text(
            "select name, sql from sqlite_master"
            " where type = 'index' and sql is not null and name like :p"
        ),
        {"p": f"%{old}%"},
    ).all()
    for name, sql in indexes:
        op.execute(f'DROP INDEX "{name}"')
        op.execute(sql.replace(name, _swap(name, forward)))
    uniques: Iterable[tuple[str, str, list[str]]] = [
        ("agenda", "uq_thread_id_project_id", ["id", "project_id"]),
        ("agenda", "uq_thread_seq", ["seq"]),
        ("agenda_history", "uq_thread_history_seq", ["seq"]),
        ("test_ref", "uq_test_ref_test_id_thread_id", ["test_id", "agenda_id"]),
    ]
    for table, name, cols in uniques:
        if not forward:
            table = _swap(table, False)
            cols = [_swap(col, False) for col in cols]
            name = _swap(name, True)
        with op.batch_alter_table(table, recreate="always") as batch:
            batch.drop_constraint(name, type_="unique")
            batch.create_unique_constraint(_swap(name, forward), cols)


def _rename_json(bind: sa.Connection, *, forward: bool) -> None:
    for table_name, old, new in HISTORY_FIELDS:
        if not forward:
            old, new = new, old
        table = _t(table_name, sa.column("id", ID), sa.column("changes", CHANGES))
        for row_id, changes in bind.execute(sa.select(table.c.id, table.c.changes)).tuples().all():
            if not any(change.get("field") == old for change in changes):
                continue
            renamed = [
                {**change, "field": new} if change.get("field") == old else change
                for change in changes
            ]
            bind.execute(sa.update(table).where(table.c.id == row_id).values(changes=renamed))
    report = _t("project_report", sa.column("id", ID), sa.column("facts", CHANGES))
    for row_id, facts in bind.execute(sa.select(report.c.id, report.c.facts)).tuples().all():
        if not isinstance(facts, dict):
            continue
        changed = False
        decisions = facts.get("decisions")
        if isinstance(decisions, dict):
            for old, new in REPORT_KEYS:
                if not forward:
                    old, new = new, old
                if old in decisions:
                    decisions[new] = decisions.pop(old)
                    changed = True
        for each in facts.get("attention") or []:
            weight = each.get("weight") if isinstance(each, dict) else None
            if not isinstance(weight, dict):
                continue
            for old, new in REPORT_WEIGHT_KEYS:
                if not forward:
                    old, new = new, old
                if old in weight:
                    weight[new] = weight.pop(old)
                    changed = True
        if changed:
            bind.execute(sa.update(report).where(report.c.id == row_id).values(facts=facts))


def downgrade() -> None:
    bind = op.get_bind()
    _rename_json(bind, forward=False)
    op.drop_index("ix_agenda_decision_trgm", table_name="agenda")
    with op.batch_alter_table("check_request") as batch:
        batch.drop_constraint(CHECK_UNIQUE, type_="unique")
    _rename(bind, forward=False)

    # 6 되돌리기 — 표는 빈 채로 다시 선다. 지운 이력 줄 · 항목 · 후보 · 참조는 못 되살린다
    with op.batch_alter_table("risk_setting") as batch:
        batch.add_column(
            sa.Column("defer_count", sa.Integer(), server_default=sa.text("2"), nullable=False)
        )
        batch.create_check_constraint(
            op.f("ck_risk_setting_defer_count_range"), "defer_count between 1 and 10"
        )
    with op.batch_alter_table("risk_setting") as batch:
        batch.alter_column("defer_count", existing_type=sa.Integer(), server_default=None)
    with op.batch_alter_table("thread") as batch:
        batch.add_column(sa.Column("parent_thread_id", ID, nullable=True))
        batch.create_foreign_key(
            "fk_thread_parent_thread_id",
            "thread",
            ["parent_thread_id", "project_id"],
            ["id", "project_id"],
        )
    _recreate_tables()

    # 4 되돌리기 — 가리킬 이력 줄이 없어 확인 요청은 지운다
    op.execute("DELETE FROM check_request")
    with op.batch_alter_table("check_request") as batch:
        batch.add_column(sa.Column("entry_id", ID, nullable=False))
        batch.create_foreign_key(
            "fk_check_request_entry_id", "entry", ["entry_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_unique_constraint(
            "uq_check_request_entry_id_recipient_id", ["entry_id", "recipient_id"]
        )
        batch.drop_column("decision")
        batch.drop_column("decision_rev")

    # 5 되돌리기 — 이행이 넣은 '결정내용' 줄을 거두고, 옛 기준(이력 줄 seq)은 셀 줄이 없어 비운다
    history = _t(
        "thread_history",
        sa.column("id", ID),
        sa.column("changes", CHANGES),
        sa.column("backfilled", sa.Boolean()),
    )
    for row_id, changes in (
        bind.execute(sa.select(history.c.id, history.c.changes).where(history.c.backfilled))
        .tuples()
        .all()
    ):
        if [change.get("field") for change in changes] == ["decision"]:
            bind.execute(sa.delete(history).where(history.c.id == row_id))
    op.execute("UPDATE test_case SET basis_seq = NULL")

    with op.batch_alter_table("thread") as batch:
        batch.drop_column("decision_rev")
        batch.drop_column("decided_at")
        batch.drop_column("decision")


def _recreate_tables() -> None:
    """0031 의 모양 그대로 — 빈 표."""
    op.create_table(
        "thread_option",
        sa.Column("id", ID, nullable=False),
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["thread_id"], ["thread.id"], name="fk_thread_option_thread_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_thread_option"),
    )
    op.create_index(
        "ix_thread_option_text_trgm",
        "thread_option",
        ["text"],
        postgresql_using="gin",
        postgresql_ops={"text": "gin_trgm_ops"},
    )
    op.create_table(
        "thread_cc",
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["member.id"], name="fk_thread_cc_member_id"),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name="fk_thread_cc_thread_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("thread_id", "member_id", name="pk_thread_cc"),
    )
    op.create_table(
        "decision_item",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("creator_id", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", UTC_TS, nullable=True),
        sa.Column("deleted_by", ID, nullable=True),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name="fk_decision_item_thread_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["creator_id"], ["member.id"], name="fk_decision_item_creator_id"),
        sa.ForeignKeyConstraint(["deleted_by"], ["member.id"], name="fk_decision_item_deleted_by"),
        sa.PrimaryKeyConstraint("id", name="pk_decision_item"),
        sa.UniqueConstraint("id", "thread_id", name="uq_decision_item_id_thread_id"),
        sa.UniqueConstraint("seq", name="uq_decision_item_seq"),
    )
    op.create_index(
        "ix_decision_item_thread_id_live",
        "decision_item",
        ["thread_id", "sort_order"],
        postgresql_where=LIVE,
        sqlite_where=LIVE,
    )
    op.create_index(
        "ix_decision_item_title_trgm",
        "decision_item",
        ["title"],
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.create_table(
        "entry",
        sa.Column("id", ID, nullable=False),
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("owner_id", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("minutes_id", ID, nullable=True),
        sa.Column("creator_id", ID, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", UTC_TS, nullable=True),
        sa.Column("deleted_by", ID, nullable=True),
        sa.Column("item_id", ID, nullable=True),
        sa.CheckConstraint(f"kind in {ENTRY_KINDS}", name=op.f("ck_entry_kind")),
        sa.ForeignKeyConstraint(["creator_id"], ["member.id"], name="fk_entry_creator_id"),
        sa.ForeignKeyConstraint(["deleted_by"], ["member.id"], name="fk_entry_deleted_by"),
        sa.ForeignKeyConstraint(
            ["item_id", "thread_id"],
            ["decision_item.id", "decision_item.thread_id"],
            name="fk_entry_item_id",
        ),
        sa.ForeignKeyConstraint(
            ["minutes_id"], ["minutes.id"], name="fk_entry_minutes_id", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["member.id"], name="fk_entry_owner_id"),
        sa.ForeignKeyConstraint(
            ["thread_id"], ["thread.id"], name="fk_entry_thread_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_entry"),
        sa.UniqueConstraint("seq", name="uq_entry_seq"),
    )
    op.create_index("ix_entry_item_id", "entry", ["item_id"])
    op.create_index("ix_entry_minutes_id", "entry", ["minutes_id"])
    op.create_index("ix_entry_thread_id_created_at", "entry", ["thread_id", "created_at"])
    for column in ("note", "text"):
        op.create_index(
            f"ix_entry_{column}_trgm",
            "entry",
            [column],
            postgresql_using="gin",
            postgresql_ops={column: "gin_trgm_ops"},
        )
    op.create_table(
        "entry_detail",
        sa.Column("id", ID, nullable=False),
        sa.Column("entry_id", ID, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["entry_id"], ["entry.id"], name="fk_entry_detail_entry_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_entry_detail"),
    )
    op.create_index(
        "ix_entry_detail_text_trgm",
        "entry_detail",
        ["text"],
        postgresql_using="gin",
        postgresql_ops={"text": "gin_trgm_ops"},
    )
