"""Shared utilities for course title extraction and detection."""

import re
from typing import List, Optional


def extract_course_title_from_content(chunks: List[str]) -> Optional[str]:
    """Extract the course title from syllabus chunk content.

    Course titles appear on the first page of a syllabus — typically a short
    line of 3-10 words with mostly capitalized words.  Scans the first chunk
    for candidate lines and returns the best match.
    """
    if not chunks:
        return None

    first_chunk = chunks[0]
    lines = [l.strip() for l in first_chunk.splitlines() if l.strip()]

    for line in lines[:30]:
        words = line.split()
        if len(words) < 3 or len(words) > 12:
            continue
        if len(line) > 120:
            continue
        # Skip lines that look like dates, emails, URLs, or bullet points
        if re.search(r'[@/\\:|•●]|^\d', line):
            continue
        # Count capitalized words (excluding short stop words)
        cap_count = sum(
            1 for w in words
            if w and w[0].isupper() and w.lower() not in {"the", "and", "of", "in", "a", "an", "for", "to"}
        )
        if cap_count >= max(2, len(words) // 2):
            return line

    return None
