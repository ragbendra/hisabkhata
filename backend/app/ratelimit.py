"""Tiny in-memory rate limiter. One process, so it is enough to slow down guessing and form spam."""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class Limiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)

    def _trim(self, key: str, window: float) -> deque:
        q = self._hits[key]
        now = time.monotonic()
        while q and now - q[0] > window:
            q.popleft()
        return q

    def blocked(self, key: str, limit: int, window: float) -> bool:
        return len(self._trim(key, window)) >= limit

    def add(self, key: str, window: float) -> None:
        self._trim(key, window).append(time.monotonic())

    def clear(self, key: str) -> None:
        self._hits.pop(key, None)

    def reset(self) -> None:
        self._hits.clear()


limiter = Limiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def too_many(msg: str = "Too many attempts. Try again later.") -> HTTPException:
    return HTTPException(429, msg)
