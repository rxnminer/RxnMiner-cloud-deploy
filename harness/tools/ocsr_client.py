"""Minimal MolParser client used by the plugin's read-first detect tool."""

from __future__ import annotations

import base64
import os
from pathlib import Path

import requests


MOLPARSER_URL = os.environ.get("MOLPARSER_URL", "http://101.126.15.37:10619/extract-mol")
# Never acceptable for this endpoint, on any run: a SOCKS hop mangles the CN-IP route.
SOCKS_PROXY_KEYS = (
    "all_proxy",
    "ALL_PROXY",
    "socks_proxy",
    "SOCKS_PROXY",
)
# Dropped on an open run, where a direct route exists and the lab proxy must not be used.
# Kept on a closed-book run, whose network is --internal: the CONNECT proxy the runner
# allow-lists this host on is then the only route out, and removing it blocks OCSR entirely.
HTTP_PROXY_KEYS = (
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
)
PROXY_KEYS = SOCKS_PROXY_KEYS + HTTP_PROXY_KEYS


def closed_book() -> bool:
    return bool(os.environ.get("CHEMRXN_NO_WEB"))


def molparser(image_path: str):
    path = Path(image_path).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"image not found: {image_path}")

    stripped = SOCKS_PROXY_KEYS if closed_book() else PROXY_KEYS
    saved = {key: os.environ.pop(key, None) for key in stripped}
    try:
        encoded = base64.b64encode(path.read_bytes()).decode()
        response = requests.post(
            MOLPARSER_URL,
            json={"batch_image": [encoded]},
            timeout=180,
            # None forces a direct connection; leaving it unset lets requests honour the
            # environment, which on a closed-book run is the allow-listed CONNECT proxy.
            proxies=None if closed_book() else {"http": None, "https": None},
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"MolParser returned non-zero status: {payload}")
        batches = payload.get("data") or []
        if not batches:
            return []
        return [
            {"bbox_index": index, **detection}
            for index, detection in enumerate(batches[0] or [])
            if isinstance(detection, dict)
        ]
    except requests.RequestException as exc:
        raise RuntimeError(
            "MolParser is unavailable. Set MOLPARSER_URL to a reachable compatible "
            f"OCSR endpoint. Current endpoint: {MOLPARSER_URL}"
        ) from exc
    finally:
        for key, value in saved.items():
            if value is not None:
                os.environ[key] = value
