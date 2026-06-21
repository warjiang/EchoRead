import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.db_queue import claim_tasks, complete_task, connect, fail_task, now_ms, recover_stale_tasks


def create_task_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE WsjWorkerTask (
          id text PRIMARY KEY NOT NULL,
          kind text NOT NULL,
          domainJobId text NOT NULL,
          domainAttempt integer NOT NULL,
          status text DEFAULT 'pending' NOT NULL,
          payloadJson text NOT NULL,
          resultJson text,
          lockedAt integer,
          lastError text,
          startedAt integer,
          finishedAt integer,
          consumedAt integer,
          createdAt integer NOT NULL,
          updatedAt integer NOT NULL
        )
        """
    )
    connection.commit()


class WsjWorkerTaskQueueTests(unittest.TestCase):
    def open_db(self):
        directory = tempfile.TemporaryDirectory()
        path = Path(directory.name) / "tasks.db"
        connection = connect(path)
        create_task_table(connection)
        self.addCleanup(connection.close)
        self.addCleanup(directory.cleanup)
        return connection

    def insert_task(self, connection, **overrides):
        now = now_ms()
        values = {
            "id": "task_1",
            "kind": "scrape",
            "domainJobId": "scrape_1",
            "domainAttempt": 1,
            "status": "pending",
            "payloadJson": json.dumps({"maxArticles": 2}),
            "createdAt": now,
            "updatedAt": now,
        }
        values.update(overrides)
        connection.execute(
            """
            INSERT INTO WsjWorkerTask (
              id, kind, domainJobId, domainAttempt, status, payloadJson,
              lockedAt, createdAt, updatedAt
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                values["id"],
                values["kind"],
                values["domainJobId"],
                values["domainAttempt"],
                values["status"],
                values["payloadJson"],
                values.get("lockedAt"),
                values["createdAt"],
                values["updatedAt"],
            ),
        )
        connection.commit()

    def test_claim_tasks_locks_pending_task(self):
        connection = self.open_db()
        self.insert_task(connection)

        tasks = claim_tasks(connection, ["scrape"], 1)

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].payload["maxArticles"], 2)
        row = connection.execute("SELECT status, lockedAt FROM WsjWorkerTask WHERE id = 'task_1'").fetchone()
        self.assertEqual(row["status"], "running")
        self.assertIsNotNone(row["lockedAt"])

    def test_complete_and_fail_tasks_write_result_state(self):
        connection = self.open_db()
        self.insert_task(connection)
        task = claim_tasks(connection, ["scrape"], 1)[0]

        complete_task(connection, task.id, {"articles": []})
        row = connection.execute("SELECT status, resultJson, finishedAt FROM WsjWorkerTask WHERE id = ?", (task.id,)).fetchone()

        self.assertEqual(row["status"], "succeeded")
        self.assertEqual(json.loads(row["resultJson"]), {"articles": []})
        self.assertIsNotNone(row["finishedAt"])

        self.insert_task(connection, id="task_2", domainJobId="scrape_2")
        task = claim_tasks(connection, ["scrape"], 1)[0]
        fail_task(connection, task.id, "boom")
        row = connection.execute("SELECT status, lastError FROM WsjWorkerTask WHERE id = ?", (task.id,)).fetchone()
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["lastError"], "boom")

    def test_recover_stale_tasks_resets_running_task(self):
        connection = self.open_db()
        self.insert_task(connection, status="running", lockedAt=now_ms() - 60 * 60 * 1000)

        recovered = recover_stale_tasks(connection, stale_after_ms=1000)
        row = connection.execute("SELECT status, lockedAt FROM WsjWorkerTask WHERE id = 'task_1'").fetchone()

        self.assertEqual(recovered, 1)
        self.assertEqual(row["status"], "pending")
        self.assertIsNone(row["lockedAt"])


if __name__ == "__main__":
    unittest.main()
