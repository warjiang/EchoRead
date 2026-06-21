import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal


TaskKind = Literal["scrape", "audio"]


@dataclass(frozen=True)
class WsjWorkerTask:
    id: str
    kind: TaskKind
    domain_job_id: str
    domain_attempt: int
    payload: dict[str, Any]


def now_ms() -> int:
    return int(time.time() * 1000)


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def recover_stale_tasks(connection: sqlite3.Connection, stale_after_ms: int = 20 * 60 * 1000) -> int:
    cutoff = now_ms() - stale_after_ms
    cursor = connection.execute(
        """
        UPDATE WsjWorkerTask
        SET status = 'pending',
            lockedAt = NULL,
            lastError = 'Recovered stale WSJ worker task',
            updatedAt = ?
        WHERE status = 'running'
          AND lockedAt IS NOT NULL
          AND lockedAt < ?
        """,
        (now_ms(), cutoff),
    )
    connection.commit()
    return cursor.rowcount


def claim_tasks(connection: sqlite3.Connection, kinds: list[TaskKind], limit: int) -> list[WsjWorkerTask]:
    claimed: list[WsjWorkerTask] = []
    if limit <= 0 or not kinds:
        return claimed

    placeholders = ",".join("?" for _ in kinds)
    for _index in range(limit):
        row = connection.execute(
            f"""
            SELECT *
            FROM WsjWorkerTask
            WHERE status = 'pending'
              AND kind IN ({placeholders})
            ORDER BY createdAt ASC
            LIMIT 1
            """,
            tuple(kinds),
        ).fetchone()
        if row is None:
            break

        locked_at = now_ms()
        updated = connection.execute(
            """
            UPDATE WsjWorkerTask
            SET status = 'running',
                lockedAt = ?,
                startedAt = COALESCE(startedAt, ?),
                lastError = NULL,
                updatedAt = ?
            WHERE id = ?
              AND status = 'pending'
            RETURNING *
            """,
            (locked_at, locked_at, locked_at, row["id"]),
        ).fetchone()
        connection.commit()
        if updated is None:
            continue

        claimed.append(
            WsjWorkerTask(
                id=updated["id"],
                kind=updated["kind"],
                domain_job_id=updated["domainJobId"],
                domain_attempt=int(updated["domainAttempt"]),
                payload=json.loads(updated["payloadJson"]),
            )
        )

    return claimed


def complete_task(connection: sqlite3.Connection, task_id: str, result: dict[str, Any]) -> None:
    now = now_ms()
    connection.execute(
        """
        UPDATE WsjWorkerTask
        SET status = 'succeeded',
            resultJson = ?,
            lockedAt = NULL,
            lastError = NULL,
            finishedAt = ?,
            updatedAt = ?
        WHERE id = ?
        """,
        (json.dumps(result, separators=(",", ":")), now, now, task_id),
    )
    connection.commit()


def fail_task(connection: sqlite3.Connection, task_id: str, error: BaseException | str) -> None:
    now = now_ms()
    message = str(error)[:1500]
    connection.execute(
        """
        UPDATE WsjWorkerTask
        SET status = 'failed',
            lockedAt = NULL,
            lastError = ?,
            finishedAt = ?,
            updatedAt = ?
        WHERE id = ?
        """,
        (message, now, now, task_id),
    )
    connection.commit()
