import logging
import os
from pathlib import Path


logger = logging.getLogger(__name__)

WSJ_HOME_URL = "https://www.wsj.com/"
WSJ_SOURCE_URLS = [
    WSJ_HOME_URL,
    "https://www.wsj.com/business",
    "https://www.wsj.com/finance",
    "https://www.wsj.com/tech",
    "https://www.wsj.com/news/world",
    "https://www.wsj.com/news/us",
    "https://www.wsj.com/world",
    "https://www.wsj.com/us-news",
    "https://www.wsj.com/economy",
    "https://www.wsj.com/politics",
]

WSJ_ARTICLE_SECTION_ROOTS = {
    "articles",
    "business",
    "economy",
    "finance",
    "lifestyle",
    "personal-finance",
    "politics",
    "real-estate",
    "tech",
    "us-news",
    "world",
}


def load_project_env() -> None:
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def configure_logging() -> None:
    level_name = os.environ.get("WSJ_WORKER_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


def database_path() -> Path:
    url = os.environ.get("DATABASE_URL", "file:./data/echoread.db")
    filename = url.removeprefix("file:") if url.startswith("file:") else url
    return Path(filename).expanduser()
