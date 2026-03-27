"""Shared utilities for course title extraction and detection."""

import re
from typing import List, Optional


_STOP_WORDS = frozenset({"the", "and", "of", "in", "a", "an", "for", "to", "at", "on", "by", "with"})

# Words that signal the end of a course title in a joined line
_ADMIN_KEYWORDS = frozenset({
    "scheduled", "meeting", "meetings", "times", "number", "credits", "credit",
    "instructor", "instructors", "elective", "prerequisite", "prerequisites",
    "office", "hours", "tbd", "response", "facilitator", "assistant",
    "description", "objectives", "overview", "grading", "attendance",
    "location", "room", "section", "day", "days", "weekly",
})

# Institution/header words — standalone short lines containing these are headers, not titles
_INSTITUTION_WORDS = frozenset({"university", "school", "college", "institute", "affairs", "program", "department"})


def _is_admin_word(w: str) -> bool:
    lw = w.lower().rstrip("s")
    return lw in _ADMIN_KEYWORDS or w.lower() in _ADMIN_KEYWORDS


def _clean_title(title: str) -> str:
    """Strip leading non-alpha chars, trailing course codes and punctuation."""
    title = re.sub(r'^[^A-Za-z]+', '', title)          # leading quotes/punct
    title = re.sub(r'\s+[A-Z]{0,3}\d{3,5}[A-Z]?\s*$', '', title)  # trailing code
    title = re.sub(r'[^\w\s]+$', '', title).strip()     # trailing punct
    return title


def extract_course_title_from_content(chunks: List[str]) -> Optional[str]:
    """Extract the course title from syllabus chunk content.

    Three-pass strategy to handle the variety of Columbia PDF formats:

    1. Standalone title lines — works when PDF line breaks are preserved.
       Allows 2-word titles (e.g. "Climate Finance") that CBS courses use.

    2. Course-code anchor — for joined lines where the title follows a
       course code (e.g. "...SUMA PS6115 Environmental Law and Policy...").
       Collects words after the code until an admin keyword or digit is hit.

    3. Quoted-title pattern — for CBS format where the title appears as
       '"Measuring and Managing Climate Risk" B8028' on its own line.
    """
    if not chunks:
        return None

    first_chunk = chunks[0]
    lines = [l.strip() for l in first_chunk.splitlines() if l.strip()]

    # Pass 1: standalone title lines (2-12 words, mostly capitalised, no admin chars)
    for line in lines[:30]:
        clean = re.sub(r'^[^A-Za-z]+', '', line)  # strip leading quotes/punct
        words = clean.split()
        if len(words) < 2 or len(words) > 12:
            continue
        if len(clean) > 120:
            continue
        if re.search(r'[@/\\:|•●]', clean) or re.match(r'^\d', clean):
            continue
        cap_count = sum(
            1 for w in words
            if w and w[0].isupper() and w.lower() not in _STOP_WORDS
        )
        if cap_count < max(2, len(words) // 2):
            continue
        # Reject institution headers ("Columbia Business School", "School of Int'l Affairs")
        if any(w.lower() in _INSTITUTION_WORDS for w in words) and len(words) <= 5:
            continue
        # Reject lines that are mostly admin words
        admin_count = sum(1 for w in words if _is_admin_word(w))
        if admin_count > len(words) // 2:
            continue
        return _clean_title(line)

    # Pass 2: course-code anchor in joined lines
    # Handles "...SUMA PS6115 Environmental Law and Policy in New York City Scheduled..."
    for line in lines[:10]:
        m = re.search(r'[A-Z]{2,6}\s+[A-Z]{0,3}\d{3,4}[A-Z]?\s+', line)
        if not m:
            continue
        after_code = line[m.end():]
        title_words: List[str] = []
        for w in after_code.split():
            if ':' in w or _is_admin_word(w) or re.match(r'^\d', w):
                break
            title_words.append(w)
            if len(title_words) >= 10:
                break
        if len(title_words) >= 2:
            title = _clean_title(' '.join(title_words))
            if title:
                return title

    return None
