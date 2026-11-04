"""안건 이행 — 리비전 0031(결정 항목) · 0032(안건 간소화, docs/api/agenda.md '이행').

메모리 sqlite 에 리비전을 차례로 얹고 그 사이에 옛 모양의 줄을 손으로 넣는다. 옛 리비전의 검사라
표 · 열 이름은 그때의 것(thread · entry …)을 쓴다. Postgres 의 이름 바꾸기(제약 · 인덱스 · 시퀀스)는
`alembic upgrade` · `downgrade` 로 사람이 확인한다 — PLAN 26단계.
"""

import json
from typing import Any

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, create_engine, text


def _revisions() -> list[Any]:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    return list(reversed(list(script.walk_revisions("base", "heads"))))


def test_migration_0031_backfills_one_item_per_decided_thread() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0031_decision_item")

    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        # sqlite 의 batch 는 표를 새로 만들고 옛 표를 지운다 — FK 를 켜 두면 줄이 같이 지워진다
        conn.exec_driver_sql("pragma foreign_keys=off")
        conn.commit()
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            # h1 정함(결정 · 지운 변경 · 세부 · 미룸) · h2 미룸만 · h3 지운 안건의 결정
            for number, (thread_id, deleted) in enumerate(
                (("h1", False), ("h2", False), ("h3", True)), start=1
            ):
                conn.execute(
                    text(
                        "insert into thread (id, project_id, title, description, state,"
                        " created_at, seq, is_deleted)"
                        " values (:id, 'p', :title, '', 'decided', '2026-09-01 00:00:00', :seq,"
                        " :deleted)"
                    ),
                    {
                        "id": thread_id,
                        "title": f"{thread_id} 안건",
                        "seq": number,
                        "deleted": deleted,
                    },
                )
            lines = [
                ("a", "h1", "defer", "2026-09-01", False),
                ("b", "h1", "decide", "2026-09-03", False),
                ("c", "h1", "change", "2026-09-02", True),
                ("d", "h1", "refine", "2026-09-04", False),
                ("e", "h2", "defer", "2026-09-05", False),
                ("f", "h3", "decide", "2026-09-06", False),
            ]
            for number, (entry_id, thread_id, kind, day, deleted) in enumerate(lines, start=1):
                conn.execute(
                    text(
                        "insert into entry (id, thread_id, kind, text, note, created_at, seq,"
                        " is_deleted) values (:id, :thread, :kind, '줄', '', :at, :seq, :deleted)"
                    ),
                    {
                        "id": entry_id,
                        "thread": thread_id,
                        "kind": kind,
                        "at": f"{day} 00:00:00",
                        "seq": number,
                        "deleted": deleted,
                    },
                )
            revisions[head].module.upgrade()

            items = conn.execute(
                text(
                    "select id, project_id, thread_id, title, creator_id, created_at, is_deleted"
                    " from decision_item"
                )
            ).all()
            assert len(items) == 1
            item = items[0]
            assert item[1:5] == ("p", "h1", "h1 안건", None)
            # 지운 줄까지 그 줄들 가운데 가장 이른 때
            assert str(item[5])[:10] == "2026-09-02" and not item[6]
            got = dict(conn.execute(text("select id, item_id from entry")).all())
            assert got == {
                "a": None,
                "b": item[0],
                "c": item[0],
                "d": item[0],
                "e": None,
                "f": None,
            }

            revisions[head].module.downgrade()
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master")).all()}
            assert "decision_item" not in tables
            columns = {row[1] for row in conn.execute(text("pragma table_info(entry)")).all()}
            assert "item_id" not in columns


# --- 0032 ---


def _insert(conn: Connection, table: str, **row: Any) -> None:
    columns = ", ".join(row)
    values = ", ".join(f":{key}" for key in row)
    conn.execute(text(f"insert into {table} ({columns}) values ({values})"), row)


def _old_data(conn: Connection) -> None:
    """0031 모양의 줄.

    - h1 '서버 OS' — 항목 하나(이름이 안건 제목과 같다): 결정(세부 하나) → 지운 변경 → 변경(세부 둘)
      → 세부 추가(refine). 확인 요청이 결정 · 변경 두 줄을 가리킨다
    - h2 '로그인 방식' — 항목 둘(SSO 정함 · 세션 아직), 지운 항목 하나(정했지만 빠진다)
    - h3 '백업 주기' — 논의중, 미룸만
    - h4 '지운 안건' — 지웠다
    """
    _insert(conn, "project", id="p", name="피", task_key_prefix="P")
    for number, (thread_id, title, state, deleted) in enumerate(
        (
            ("h1", "서버 OS", "decided", False),
            ("h2", "로그인 방식", "open", False),
            ("h3", "백업 주기", "open", False),
            ("h4", "지운 안건", "decided", True),
        ),
        start=1,
    ):
        _insert(
            conn,
            "thread",
            id=thread_id,
            project_id="p",
            title=title,
            description="",
            state=state,
            created_at="2026-09-01 00:00:00",
            seq=number,
            is_deleted=deleted,
        )
    for number, (item_id, thread_id, title, order, deleted) in enumerate(
        (
            ("i1", "h1", " 서버 OS ", 0, False),
            ("i2", "h2", "SSO", 0, False),
            ("i3", "h2", "세션 길이", 1, False),
            ("i4", "h2", "지운 항목", 2, True),
            ("i5", "h4", "지운 안건", 0, False),
        ),
        start=1,
    ):
        _insert(
            conn,
            "decision_item",
            id=item_id,
            project_id="p",
            thread_id=thread_id,
            title=title,
            created_at="2026-09-01 00:00:00",
            sort_order=order,
            seq=number,
            is_deleted=deleted,
        )
    lines = [
        # (id, 안건, 항목, kind, 글, 만든 사람, 날, 지움)
        ("a", "h1", "i1", "decide", "우분투", "u1", "2026-09-02", False),
        ("b", "h2", "i2", "decide", "SSO 를 쓴다", "u2", "2026-09-03", False),
        ("c", "h1", "i1", "change", "지운 변경", "u1", "2026-09-04", True),
        ("d", "h1", "i1", "change", "록키", "u3", "2026-09-05", False),
        ("e", "h1", "i1", "refine", "9.4 로", "u3", "2026-09-06", False),
        ("f", "h2", "i4", "decide", "빠질 결정", "u2", "2026-09-07", False),
        ("g", "h3", None, "defer", "미룸", "u2", "2026-09-08", False),
        ("h", "h4", "i5", "decide", "지운 안건의 결정", "u1", "2026-09-09", False),
    ]
    for number, (entry_id, thread_id, item_id, kind, body, by, day, deleted) in enumerate(
        lines, start=1
    ):
        _insert(
            conn,
            "entry",
            id=entry_id,
            thread_id=thread_id,
            item_id=item_id,
            kind=kind,
            text=body,
            note="",
            creator_id=by,
            created_at=f"{day} 00:00:00",
            seq=number,
            is_deleted=deleted,
        )
    for detail_id, entry_id, body, order in (
        ("ad", "a", "최신 LTS", 0),
        ("dd1", "d", "라이선스 때문", 0),
        ("dd2", "d", "사내 표준", 1),
    ):
        _insert(conn, "entry_detail", id=detail_id, entry_id=entry_id, text=body, sort_order=order)
    for number, (check_id, entry_id, recipient) in enumerate(
        (("c1", "a", "u2"), ("c2", "d", "u2"), ("c3", "d", "u4")), start=1
    ):
        _insert(
            conn,
            "check_request",
            id=check_id,
            project_id="p",
            thread_id="h1",
            entry_id=entry_id,
            sender_id="u1",
            recipient_id=recipient,
            created_at="2026-09-10 00:00:00",
            seq=number,
            load_open_tasks=0,
            load_blocked_tasks=0,
            load_due_soon_tasks=0,
            load_open_threads=0,
        )
    # 테스트 — x1 은 결정 a 뒤 · 변경 d 앞에서 봤다(바뀜 있음), x2 는 다 보고 났다(없음),
    # x3 은 h1 · h2 에 닿고 h2 의 결정 b 앞에서 봤다(h2 만 바뀜), x4 는 닿는 안건이 없다
    for number, (test_id, basis, refs) in enumerate(
        (
            ("x1", 1, ["h1"]),
            ("x2", 8, ["h1", "h2"]),
            ("x3", 1, ["h2"]),
            ("x4", None, ["h3"]),
        ),
        start=1,
    ):
        _insert(
            conn,
            "test_case",
            id=test_id,
            project_id="p",
            key=f"P-T{number}",
            seq=number,
            title="테스트",
            status_changed_at="2026-09-01 00:00:00",
            created_at="2026-09-01 00:00:00",
            basis_seq=basis,
        )
        for place, thread_id in enumerate(refs):
            _insert(
                conn,
                "test_ref",
                id=f"{test_id}r{place}",
                test_id=test_id,
                project_id="p",
                thread_id=thread_id,
            )
    _insert(
        conn,
        "task_history",
        id="th1",
        project_id="p",
        task_id="k",
        changed_at="2026-09-01 00:00:00",
        seq=1,
        changes=json.dumps([{"field": "thread", "from": None, "to": "h1", "subject": ""}]),
        backfilled=False,
    )
    facts = {
        "decisions": {
            "decidedThreadIds": ["h1"],
            "deferredThreadIds": ["h3"],
            "riskyThreadIds": [],
        },
        "attention": [{"taskId": "k", "weight": {"threadCount": 2}}],
    }
    _insert(
        conn,
        "project_report",
        id="r1",
        project_id="p",
        period_start="2026-09-01",
        period_end="2026-09-07",
        facts=json.dumps(facts),
        body="[[thread:h1]]",
        created_by="u1",
        created_at="2026-09-07 00:00:00",
        seq=1,
    )


def test_migration_0032_moves_decisions_into_the_agenda() -> None:
    revisions = _revisions()
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0032_agenda")

    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        # sqlite 의 batch 는 표를 새로 만들고 옛 표를 지운다 — FK 를 켜 두면 줄이 같이 지워진다
        conn.exec_driver_sql("pragma foreign_keys=off")
        conn.commit()
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            _old_data(conn)
            revisions[head].module.upgrade()

            agendas = {
                row[0]: row[1:]
                for row in conn.execute(
                    text("select id, decision, state, decided_at, decision_rev from agenda")
                ).all()
            }
            # 항목 하나 · 이름이 제목과 같으면(앞뒤 공백 뗀) 결정 글만. 지금 유효한 결정은
            # 지우지 않은 마지막 변경(d) — 그 세부, 그 뒤의 refine 이 '- ' 줄로
            assert agendas["h1"][0] == "록키\n- 라이선스 때문\n- 사내 표준\n- 9.4 로"
            assert agendas["h1"][1] == "decided" and str(agendas["h1"][2])[:10] == "2026-09-05"
            # 확인 요청이 가리킨 서로 다른 결정 줄 둘
            assert agendas["h1"][3] == 2
            # 항목이 여럿이면 '항목명: 결정', 정한 것 없는 항목 · 지운 항목은 빠진다
            assert agendas["h2"] == ("SSO: SSO 를 쓴다", "open", None, 1)
            assert agendas["h3"] == ("", "open", None, 0)

            checks = conn.execute(
                text("select id, agenda_id, decision_rev, decision from check_request order by seq")
            ).all()
            assert checks == [
                ("c1", "h1", 1, "우분투"),
                ("c2", "h1", 2, "록키"),
                ("c3", "h1", 2, "록키"),
            ]

            # 결정 바뀜이 있던 안건(지우지 않은)마다 '결정내용' 줄 — 옛 마지막 결정 줄 순.
            # h2 의 마지막은 지운 항목의 f(seq 6)라 h1 의 d(seq 4) 뒤다 — 옛 기준도 항목을 안 봤다
            filled = conn.execute(
                text(
                    "select agenda_id, seq, changed_by, changed_at, changes, backfilled"
                    " from agenda_history order by seq"
                )
            ).all()
            # 바꾼 사람 · 때는 결정내용에 쓴 결정 줄(h2 는 f 가 아니라 b)
            assert [(row[0], row[2], str(row[3])[:10], row[5]) for row in filled] == [
                ("h1", "u3", "2026-09-05", 1),
                ("h2", "u2", "2026-09-03", 1),
            ]
            assert json.loads(filled[0][4]) == [
                {"field": "decision", "from": "", "to": agendas["h1"][0], "subject": ""}
            ]
            h1_seq, h2_seq = filled[0][1], filled[1][1]

            # 테스트 — 바뀜 있음 · 없음이 그대로다
            basis = dict(conn.execute(text("select id, basis_seq from test_case")).all())
            assert basis["x1"] is not None and basis["x1"] < h1_seq  # h1 바뀜 그대로
            assert basis["x2"] == h2_seq  # 둘 다 봤다
            assert basis["x3"] is not None and basis["x3"] < h2_seq
            assert basis["x4"] is None

            # 이름 — 표 · 열 · 이력 JSON · 리포트 키
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master"))}
            assert {"agenda", "agenda_history", "task_agenda_link"} <= tables
            assert not tables & {
                "thread",
                "thread_history",
                "task_thread_link",
                "entry",
                "entry_detail",
                "decision_item",
                "thread_option",
                "thread_cc",
            }
            columns = {row[1] for row in conn.execute(text("pragma table_info(test_ref)"))}
            assert "agenda_id" in columns and "thread_id" not in columns
            columns = {row[1] for row in conn.execute(text("pragma table_info(risk_setting)"))}
            assert "defer_count" not in columns
            (changes,) = conn.execute(text("select changes from task_history")).scalars()
            assert json.loads(changes)[0]["field"] == "agenda"
            (facts,) = conn.execute(text("select facts from project_report")).scalars()
            facts = json.loads(facts)
            assert facts["decisions"] == {
                "decidedAgendaIds": ["h1"],
                "deferredAgendaIds": ["h3"],
                "riskyAgendaIds": [],
            }
            assert facts["attention"][0]["weight"] == {"agendaCount": 2}

            # downgrade — 이름 · 칸만. 지운 이력 줄은 못 되살리고, 확인 요청은 지운다
            revisions[head].module.downgrade()
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master"))}
            assert {"thread", "thread_history", "entry", "decision_item", "thread_cc"} <= tables
            assert "agenda" not in tables
            assert conn.execute(text("select count(*) from entry")).scalar() == 0
            assert conn.execute(text("select count(*) from check_request")).scalar() == 0
            assert conn.execute(text("select count(*) from thread_history")).scalar() == 0
            columns = {row[1] for row in conn.execute(text("pragma table_info(thread)"))}
            assert "parent_thread_id" in columns and "decision" not in columns
            (changes,) = conn.execute(text("select changes from task_history")).scalars()
            assert json.loads(changes)[0]["field"] == "thread"
            (facts,) = conn.execute(text("select facts from project_report")).scalars()
            assert "decidedThreadIds" in json.loads(facts)["decisions"]

            # 다시 올려도 선다(빈 이력이라 결정내용은 비어 있다)
            revisions[head].module.upgrade()
            assert conn.execute(text("select count(*) from agenda")).scalar() == 4
