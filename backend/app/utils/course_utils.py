"""Shared utilities for course title extraction and detection."""

import re
from typing import List, Optional


def extract_course_title_from_content(chunks: List[str]) -> Optional[str]:
    """Extract the course title from syllabus chunk content.

    Course titles appear on the first page of a syllabus — typically a short
    line of 3-10 words with mostly capitalized words.  Scans the first chunk
    for candidate lines and returns the best match.

    Two-pass strategy:
    1. Look for standalone title lines (clean ingest, lines preserved)
    2. Look for "COURSE_CODE: Title" patterns in joined lines (aggressive PDF
       line-joining can merge multiple lines into one, hiding the title)
    """
    if not chunks:
        return None

    first_chunk = chunks[0]
    lines = [l.strip() for l in first_chunk.splitlines() if l.strip()]

    # Pass 1: standalone title lines
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

    # Pass 2: course-code colon pattern in joined/long lines
    # Handles "...SUMA PS6130: Environmental Policy and Ecosystem Services Spring 2025..."
    for line in lines[:15]:
        match = re.search(
            r'[A-Z]{2,6}\s+[A-Z]{0,3}\d{3,4}[A-Z]?\s*:\s*([A-Z][^:@\n]{5,80}?)(?:\s{2,}|\s*(?:Spring|Fall|Summer|Winter|20\d{2})\b|$)',
            line
        )
        if match:
            title = match.group(1).strip()
            words = title.split()
            if 3 <= len(words) <= 15:
                return title

    return None
