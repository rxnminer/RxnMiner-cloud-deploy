#!/usr/bin/env python3
"""Lightweight MolParser Extended-SMILES 2.0 syntax sanity checker.

This is intentionally conservative. It checks separator presence, known record
shapes, simple index fields, repeat markers, and unsupported strict-XML
assumptions. It does not validate chemistry or RDKit atom indexing.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass


KNOWN_RECORD_TAGS = ("a", "d", "r", "c", "g", "v")
INLINE_LABEL_TAGS = {"sep", "id", "dum", "red", "blue", "ball", "rectangle", "RNA", "DNA", "protein"}

RECORD_RE = re.compile(r"<(?P<tag>a|d|r|c|g|v)>(?P<body>.*?)</(?P=tag)>", re.DOTALL)
SG_RE = re.compile(r"\|Sg:([^|]+)\|")
INDEXED_VALUE_RE = re.compile(r"^(?P<index>\d+):(?P<value>.+)$", re.DOTALL)
RING_TARGET_RE = re.compile(r"^<(?P<target>c|v)>(?P<index>\d+):(?P<value>.+)$", re.DOTALL)
G_BODY_RE = re.compile(r"^(?P<ports>(?:\[\d+:\d+\]:)+)\|Sg:(?P<count>[^|]+)\|$", re.DOTALL)
V_BODY_RE = re.compile(r"^(?P<index>\d+):(?P<name>[^:]+):\[(?P<from>\d+):(?P<to>\d+)\]$", re.DOTALL)
REPEAT_COUNT_RE = re.compile(r"^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$")


@dataclass
class Message:
    level: str
    text: str


def add(messages: list[Message], level: str, text: str) -> None:
    messages.append(Message(level, text))


def validate_indexed_record(tag: str, body: str, messages: list[Message]) -> None:
    match = INDEXED_VALUE_RE.match(body.strip())
    if not match:
        add(messages, "error", f"<{tag}> body should be [ATOM_INDEX]:[VALUE], got: {body!r}")
        return
    if not match.group("value").strip():
        add(messages, "error", f"<{tag}> value is empty")


def validate_r_record(body: str, messages: list[Message]) -> None:
    stripped = body.strip()
    ring_match = INDEXED_VALUE_RE.match(stripped)
    abstract_match = RING_TARGET_RE.match(stripped)
    if not ring_match and not abstract_match:
        add(messages, "error", f"<r> body should target a ring index, <c>, or <v>, got: {body!r}")
        return
    value = (ring_match or abstract_match).group("value")
    if not value.strip():
        add(messages, "error", "<r> group value is empty")


def validate_g_record(body: str, messages: list[Message]) -> None:
    stripped = body.strip()
    match = G_BODY_RE.match(stripped)
    if not match:
        add(messages, "error", f"<g> body should be [INNER:OUTER]:...:|Sg:n|, got: {body!r}")
        return
    count = match.group("count").strip()
    if not REPEAT_COUNT_RE.match(count):
        add(messages, "warning", f"<g> repeat count {count!r} is unusual; expected n, 20, or m-n style")


def validate_v_record(body: str, messages: list[Message]) -> None:
    stripped = body.strip()
    match = V_BODY_RE.match(stripped)
    if not match:
        add(messages, "error", f"<v> body should be [VIRTUALARC_INDEX]:[NAME]:[FROM:TO], got: {body!r}")
        return
    if not match.group("name").strip():
        add(messages, "error", "<v> name is empty")


def check_tag_counts(extension: str, messages: list[Message]) -> None:
    for tag in (*KNOWN_RECORD_TAGS, "s"):
        opens = len(re.findall(fr"<{tag}>", extension))
        closes = len(re.findall(fr"</{tag}>", extension))
        if opens != closes:
            add(messages, "error", f"tag <{tag}> has {opens} opening and {closes} closing tags")

    for label in re.findall(r"<(/?)([A-Za-z][A-Za-z0-9_-]*)>", extension):
        slash, tag = label
        if slash:
            continue
        if tag in KNOWN_RECORD_TAGS or tag in {"s"} or tag in INLINE_LABEL_TAGS:
            continue
        add(messages, "warning", f"unknown inline label <{tag}>; confirm it is an intentional group label")


def check_nested_substructures(extension: str, messages: list[Message]) -> None:
    for match in re.finditer(r"<s>(.*?)</s>", extension, re.DOTALL):
        body = match.group(1)
        if "<sep>" not in body:
            add(messages, "error", "<s> substructure must contain its own <sep>")


def validate(esmiles: str, strict: bool = False) -> list[Message]:
    messages: list[Message] = []
    text = esmiles.strip()
    if "<sep>" not in text:
        add(messages, "error", "expected a top-level <sep> separator")
        return messages

    base, extension = text.split("<sep>", 1)
    if not base.strip():
        add(messages, "error", "base SMILES before <sep> is empty")

    check_tag_counts(extension, messages)
    check_nested_substructures(extension, messages)

    seen_spans: list[tuple[int, int]] = []
    for match in RECORD_RE.finditer(extension):
        tag = match.group("tag")
        body = match.group("body")
        seen_spans.append(match.span())
        if tag in {"a", "d", "c"}:
            validate_indexed_record(tag, body, messages)
        elif tag == "r":
            validate_r_record(body, messages)
        elif tag == "g":
            validate_g_record(body, messages)
        elif tag == "v":
            validate_v_record(body, messages)

    if SG_RE.search(extension):
        for count in SG_RE.findall(extension):
            if not REPEAT_COUNT_RE.match(count.strip()):
                add(messages, "warning", f"|Sg:{count}| repeat count is unusual; expected n, 20, or m-n style")

    leftovers = extension
    for start, end in sorted(seen_spans, reverse=True):
        leftovers = leftovers[:start] + leftovers[end:]
    leftovers = SG_RE.sub("", leftovers)
    leftovers = re.sub(r"<s>.*?</s>", "", leftovers, flags=re.DOTALL)
    if leftovers.strip():
        level = "error" if strict else "warning"
        add(messages, level, f"unparsed extension text remains: {leftovers.strip()!r}")

    if not any(message.level == "error" for message in messages):
        add(messages, "ok", "basic Extended-SMILES syntax checks passed")
    return messages


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate basic MolParser Extended-SMILES 2.0 syntax.")
    parser.add_argument("esmiles", nargs="?", help="E-SMILES string. If omitted, stdin is used.")
    parser.add_argument("--strict", action="store_true", help="Treat unparsed extension text as an error.")
    args = parser.parse_args(argv)

    text = args.esmiles if args.esmiles is not None else sys.stdin.read()
    messages = validate(text, strict=args.strict)
    for message in messages:
        print(f"[{message.level}] {message.text}")
    return 1 if any(message.level == "error" for message in messages) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
