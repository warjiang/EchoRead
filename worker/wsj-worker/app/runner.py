import argparse
import asyncio
from typing import Literal

from pydantic import ValidationError

from app.audio import build_audio_job_callback
from app.config import configure_logging, database_path, load_project_env, logger
from app.db_queue import TaskKind, claim_tasks, complete_task, connect, fail_task, recover_stale_tasks
from app.models import AudioJobRequest
from app.scraper import collect_articles


WorkerStage = Literal["all", "scrape", "audio"]


def stage_kinds(stage: WorkerStage) -> list[TaskKind]:
    if stage == "scrape":
        return ["scrape"]
    if stage == "audio":
        return ["audio"]
    return ["scrape", "audio"]


async def process_task(connection, task) -> None:
    logger.info("Processing WSJ worker task %s kind=%s domainJob=%s", task.id, task.kind, task.domain_job_id)
    try:
        if task.kind == "scrape":
            max_articles = int(task.payload.get("maxArticles", 5))
            result = await collect_articles(max_articles)
            complete_task(connection, task.id, result.model_dump(mode="json"))
            return

        if task.kind == "audio":
            request = AudioJobRequest(**task.payload)
            result = await build_audio_job_callback(request)
            complete_task(connection, task.id, result.model_dump(mode="json", exclude_none=True))
            return

        raise ValueError(f"Unsupported WSJ worker task kind: {task.kind}")
    except (ValidationError, Exception) as error:
        logger.exception("WSJ worker task %s failed", task.id)
        fail_task(connection, task.id, error)


async def run_once(stage: WorkerStage, limit: int) -> int:
    with connect(database_path()) as connection:
        recovered = recover_stale_tasks(connection)
        if recovered:
            logger.info("Recovered %s stale WSJ worker task(s)", recovered)

        tasks = claim_tasks(connection, stage_kinds(stage), limit)
        for task in tasks:
            await process_task(connection, task)
        return len(tasks)


async def run_loop(stage: WorkerStage, once: bool, interval_ms: int, limit: int) -> None:
    logger.info("EchoRead Python WSJ worker starting stage=%s once=%s intervalMs=%s", stage, once, interval_ms)
    while True:
        processed = await run_once(stage, limit)
        if once:
            break
        await asyncio.sleep(0.25 if processed else interval_ms / 1000)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EchoRead DB-backed WSJ Python worker")
    parser.add_argument("--stage", choices=["all", "scrape", "audio"], default="all")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval-ms", type=int, default=30_000)
    parser.add_argument("--limit", type=int, default=1)
    return parser.parse_args()


def main() -> None:
    load_project_env()
    configure_logging()
    args = parse_args()
    asyncio.run(
        run_loop(
            stage=args.stage,
            once=args.once,
            interval_ms=max(250, args.interval_ms),
            limit=max(1, args.limit),
        )
    )


if __name__ == "__main__":
    main()
