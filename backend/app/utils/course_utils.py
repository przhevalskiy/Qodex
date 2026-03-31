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
    "location", "room", "section", "day", "days", "weekly", "time",
    "schedule", "lecture", "lab", "discussion", "email", "phone",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
})

# Words within a colon-terminated token that signal an admin boundary
_COLON_ADMIN = frozenset({
    "lecture", "lab", "section", "day", "time", "location", "room", "schedule",
    "discussion", "monday", "tuesday", "wednesday", "thursday", "friday",
    "office", "instructor", "email", "prerequisite", "prerequisites",
    "credits", "credit", "dates", "date", "overview", "description",
})

# Institution/header words — standalone short lines containing these are headers, not titles
_INSTITUTION_WORDS = frozenset({"university", "school", "college", "institute", "affairs", "program", "department"})

# Semester/year markers that end a title
_SEMESTER_RE = re.compile(
    r'\s+(?:Spring|Fall|Summer|Winter|January|20\d{2})\b.*$', re.IGNORECASE
)

# Embedded articles/prepositions that appear within CamelCase joined text.
# NOTE: no IGNORECASE — the lookahead (?=[A-Z]) must match uppercase only,
# to detect word boundaries like 'SolarProjectandTechnology' → 'and' before 'T'.
_EMBEDDED_WORDS_RE = re.compile(
    r'(?<=[a-z])(and|or|of|in|for|the|to|by|with|from|its|via)(?=[A-Z])'
)


def _is_admin_word(w: str) -> bool:
    lw = w.lower().rstrip("s")
    return lw in _ADMIN_KEYWORDS or w.lower() in _ADMIN_KEYWORDS


def _clean_title(title: str) -> str:
    """Strip leading non-alpha chars, trailing course codes and punctuation."""
    title = re.sub(r'^[^A-Za-z]+', '', title)           # leading quotes/punct
    title = re.sub(r'\s+[A-Z]{0,3}\d{3,5}[A-Z]?\s*$', '', title)  # trailing code
    title = _SEMESTER_RE.sub('', title)                  # trailing semester/year
    title = re.sub(r'\s*\([^)]*\)\s*$', '', title)       # trailing parenthetical
    title = re.sub(r'[^\w\s,:\-\'&]+$', '', title).strip()  # trailing punct
    return title


def _split_camelcase(raw: str) -> str:
    """Split a CamelCase or joined-word string into spaced words.

    Two steps:
      1. Insert space before embedded articles/prepositions (e.g. 'Policyand' → 'Policy and')
      2. Standard lowercase→uppercase boundary split
    """
    # Step 1: surface embedded lowercase connector words
    raw = _EMBEDDED_WORDS_RE.sub(r' \1 ', raw)
    # Step 2: standard CamelCase split
    raw = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', raw)
    # Clean extra spaces introduced by step 1
    return re.sub(r'\s+', ' ', raw).strip()


def _is_letter_spaced(text: str) -> bool:
    """Return True if text shows signs of PDF letter-spacing artifact.

    These PDFs insert spaces between letters/syllables:
    e.g. 'Imp a ct F in an ce' instead of 'Impact Finance'.
    """
    tokens = text.split()
    if len(tokens) < 6:
        return False
    short = sum(1 for t in tokens if len(t) <= 2)
    return short / len(tokens) >= 0.35


def _repair_letter_spaced(text: str) -> str:
    """Collapse PDF letter-spacing artifact, then CamelCase-split.

    'Imp a ct F in an ce for Sust a in a bility' → 'Impact Finance for Sustainability'
    """
    collapsed = re.sub(r'\s+', '', text)
    return _split_camelcase(collapsed)


def extract_course_title_from_filename(filename: str) -> Optional[str]:
    """Extract a course title from the filename as a last-resort fallback.

    Strips the instructor prefix, extension, course codes, and generic
    qualifiers (syllabus, fall, year, etc.), then returns whatever meaningful
    text remains (≥ 2 words).
    """
    # Reject filenames with square brackets — they embed complex metadata we can't parse
    if '[' in filename:
        return None

    name = re.sub(r'\.\w+$', '', filename)                  # strip extension
    # Strip CamelCase instructor prefix (e.g. "BruceUsher_" or "AlexDeSherbinin_")
    name = re.sub(r'^(?:[A-Z][a-zA-Z]+)+_', '', name)
    # Normalise underscores → spaces so word boundaries work for subsequent strips
    name = name.replace('_', ' ')
    # Strip compact course codes (e.g. CLMT5051, BUSIB8712, GU4050, B8363)
    name = re.sub(
        r'\b(?:CLMT|SUMA|SIPA|SPS|BUSIB?|INAF|DVGO|EESC|EACEE|GR|GU|PS|B|E)\s*\d{3,5}[A-Z]?\b',
        '', name, flags=re.IGNORECASE
    )
    # Strip standalone department codes, version tags, and noise words
    # Also handle underscore/hyphen-adjacent variants (e.g. "_credits_3June" pattern)
    name = re.sub(r'[-_](?:credits?|3june|vf|final|rev|docx)\b', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\b(?:SUMA|SPS|GIP|GR|PS|CBS|secTH\d+|v\d+|vf|final|rev|docx|credits?|3june)\b', '', name, flags=re.IGNORECASE)
    # Strip semester/year and everything after (handles both space and hyphen/underscore separators)
    name = re.sub(r'[-_\s]+(?:Spring|Fall|Summer|Winter|January|20\d{2})\b.*$', '', name, flags=re.IGNORECASE)
    # Remove the word "Syllabus" (keep what follows — some filenames put the title after it)
    name = re.sub(r'\bsyllabus\b[\s-]*', '', name, flags=re.IGNORECASE)
    # Replace remaining hyphens and brackets with spaces
    name = re.sub(r'[-\[\]()]+', ' ', name)
    # Remove stray numbers and date fragments
    name = re.sub(r'\b\d[\d.]+\b', '', name)
    name = re.sub(r'\s+', ' ', name).strip().strip('-').strip()

    # Apply CamelCase split when result is still a joined word (e.g. "ClimatePolicy")
    if ' ' not in name and len(name) > 5:
        name = _split_camelcase(name)
    name = re.sub(r'\s+', ' ', name).strip()

    words = name.split()
    if len(words) >= 2:
        # Cap at 10 words to avoid capturing long filename fragments as titles
        return _clean_title(' '.join(words[:10]))
    # Accept a single long capitalised word (≥10 chars) as a subject title (e.g. "Agroecology")
    if len(words) == 1 and len(words[0]) >= 10 and words[0][0].isupper():
        return _clean_title(words[0])
    return None


def extract_course_title_from_content(chunks: List[str], filename: str = "") -> Optional[str]:
    """Extract the course title from syllabus chunk content.

    Multi-pass strategy to handle the full variety of Columbia PDF formats:

    0a. Explicit "Course Title:" label — highest confidence, used by SIPA/SPS templates.
    0b. ALLCAPS title line — for PDFs that open with the course title in all-caps
        (e.g. "DYNAMICS OF CLIMATE VARIABILITY AND CHANGE").
    0c. CBS B#### code + title — handles "B8363 CLIMATE FINANCE Fall 2025" and
        "B8320/E4444 Climate Tech Spring 2025".
    0d. ALLCAPS title before course code — handles "CLIMATE JUSTICE: THEORY...CLMT5023GR".
    0e. Letter-spaced artifact repair — PDFs that insert spaces between letters:
        "Imp a ct F in an ce" → "Impact Finance".
    0f. CamelCase title with code in parens — "FinancingtheCleanEnergyEconomy(SUMAPS5197)".
     1. Standalone title lines — well-formatted PDFs where title is its own line.
        Colon allowed when it appears after word 3+ (subtitle separator).
     2. Spaced course-code anchor — "SUMA PS6115 Environmental Law and Policy...".
        Allows optional colon after course number.
     3. No-space SUMA CamelCase — joined-text PDFs: "SUMAPS5060SolarProject...TBD".
     4. Compact course-code anchor — codes with no space between letters and digits
        (CLMTGR5013, INAFU6264, BUSIB8712). Title precedes the compact code.
     5. "Title Syllabus" pattern — title precedes the word "Syllabus" on first line.
     6. Filename fallback — derive title from the filename when content yields nothing.
    """
    if not chunks:
        return None

    first_chunk = chunks[0]
    text = first_chunk                                      # full text for label searches
    lines = [l.strip() for l in first_chunk.splitlines() if l.strip()]

    # ── Pass 0a: Explicit "Course Title:" label ──────────────────────────────
    m = re.search(r'(?i)course\s*title\s*:\s*([^\n\r]{5,120})', text[:1500])
    if m:
        title = _clean_title(m.group(1).strip())
        # Trim at embedded metadata boundary (e.g. "Course Title: Foo Institution: Columbia")
        title = re.sub(
            r'\s+(?:Institution|Semester|Term|Credits?|Course\s+Number|Section|Instructor'
            r'|School|Department|Program)\s*:.*$',
            '', title, flags=re.IGNORECASE
        ).strip()
        if title and 2 <= len(title.split()) <= 12:
            return title

    # ── Pass 0b: ALLCAPS title line ───────────────────────────────────────────
    # First non-trivial line that is entirely (or mostly) ALLCAPS and not an
    # institution header or admin line.
    for line in lines[:8]:
        clean = re.sub(r'^[^A-Za-z]+', '', line)
        # Skip lines starting with a course code — handled by Pass 0c/0d
        if re.match(r'^[A-Z]\d{3,5}', clean):
            continue
        words = clean.split()
        if len(words) < 2 or len(words) > 10:
            continue
        if len(clean) > 100:
            continue
        # Must have ≥ 60 % uppercase words (length > 1)
        allcaps = [w for w in words if w.isupper() and len(w) > 1]
        if len(allcaps) < max(2, len(words) * 6 // 10):
            continue
        if any(w.lower().rstrip(':') in _ADMIN_KEYWORDS for w in words):
            continue
        if any(w.lower() in _INSTITUTION_WORDS for w in words) and len(words) <= 5:
            continue
        title = _clean_title(clean.title())
        if title and len(title.split()) >= 2:
            return title

    # ── Pass 0c: CBS B#### code then title ───────────────────────────────────
    # e.g. "B8363 CLIMATE FINANCE Fall 2025" or "B8320/E4444 Climate Tech Spring 2025"
    for line in lines[:10]:
        m = re.search(
            r'\b[A-Z]\d{4}(?:[/][A-Z]?\d{3,5})?\s+'
            r'([A-Z][A-Za-z\s,\-:\'&]{5,80}?)'
            r'\s+(?:Spring|Fall|Summer|Winter|January|20\d{2}|\d+\.\d)',
            line
        )
        if m:
            candidate = m.group(1).strip().rstrip(',').strip()
            words = candidate.split()
            if 2 <= len(words) <= 10:
                admin_ct = sum(1 for w in words if _is_admin_word(w))
                if admin_ct <= len(words) // 2:
                    title = _clean_title(candidate)
                    if title:
                        # Title-case if all-caps
                        if title == title.upper():
                            title = title.title()
                        return title

    # ── Pass 0d: ALLCAPS title before course code at line end ─────────────────
    # e.g. "CLIMATE JUSTICE: THEORY, PRACTICE, AND POLICY CLMT5023GR"
    for line in lines[:10]:
        m = re.search(
            r'^([A-Z][A-Z\s,:\-\']{10,80})\s+[A-Z]{2,8}\d{3,5}[A-Z]?(?:\s|$)',
            line
        )
        if m:
            candidate = m.group(1).strip().rstrip(',').strip()
            words = candidate.split()
            if 2 <= len(words) <= 12:
                if not any(w.lower() in _INSTITUTION_WORDS for w in words):
                    title = _clean_title(candidate.title())
                    if title and len(title.split()) >= 2:
                        return title

    # ── Pass 0e: Letter-spaced PDF artifact repair ──────────────────────────
    # Some PDFs insert spaces between letters/syllables:
    # 'Imp a ct F in an ce for Sust a in a bility' → 'Impact Finance for Sustainability'
    for line in lines[:8]:
        clean = re.sub(r'^[^A-Za-z]+', '', line)
        if not _is_letter_spaced(clean):
            continue
        repaired = _repair_letter_spaced(clean)
        if not repaired or not repaired[0].isupper():
            continue  # truncated first char — fall through to filename fallback
        rep_words = repaired.split()
        while rep_words and _is_admin_word(rep_words[-1]):
            rep_words.pop()
        if len(rep_words) < 2:
            continue
        title = _clean_title(' '.join(rep_words))
        if title and len(title.split()) >= 2 and len(title) > 5:
            return title

    # ── Pass 0f: CamelCase title with course code in parens ──────────────────
    # e.g. "FinancingtheCleanEnergyEconomy(SUMAPS5197)"
    for line in lines[:5]:
        m = re.match(
            r'^([A-Z][a-zA-Z]{8,})\s*\([A-Z]{2,8}\s*[A-Z]{0,3}\s*\d{3,5}[A-Z]?\)',
            line.strip()
        )
        if m:
            spaced = _split_camelcase(m.group(1))
            words = spaced.split()
            while words and _is_admin_word(words[-1]):
                words.pop()
            if len(words) >= 2:
                title = _clean_title(' '.join(words))
                if title and len(title.split()) >= 2:
                    return title

    # ── Pass 1: standalone title lines ───────────────────────────────────────
    # 2-12 words, mostly capitalised.
    # Colon is allowed when it appears after the 3rd word (subtitle separator)
    # but rejected if it appears in the first two words of a short line.
    for line in lines[:30]:
        clean = re.sub(r'^[^A-Za-z]+', '', line)
        words = clean.split()
        if len(words) < 2 or len(words) > 12:
            continue
        if len(clean) > 120:
            continue
        # Hard rejects
        if re.search(r'[@/\\|•●]', clean) or re.match(r'^\d', clean):
            continue
        # Colon in first word, or colon within a ≤3-word line → admin line
        if words and ':' in words[0]:
            continue
        if len(words) <= 3 and any(':' in w for w in words):
            continue
        cap_count = sum(
            1 for w in words
            if w and w[0].isupper() and w.lower().rstrip(',:') not in _STOP_WORDS
        )
        if cap_count < max(2, len(words) // 2):
            continue
        if any(w.lower() in _INSTITUTION_WORDS for w in words) and len(words) <= 5:
            continue
        admin_count = sum(1 for w in words if _is_admin_word(w.rstrip(':,')))
        if admin_count > len(words) // 2:
            continue
        return _clean_title(line)

    # ── Pass 2: spaced course-code anchor ────────────────────────────────────
    # "SUMA PS5168: Sustainability Metrics..." — optional colon after course number.
    # Smarter colon handling inside the collected title.
    for line in lines[:10]:
        m = re.search(r'[A-Z]{2,6}\s+[A-Z]{0,3}\d{3,4}[A-Z]?[:\s]\s*', line)
        if not m:
            continue
        after_code = re.sub(r'^[-–—_\s]+', '', line[m.end():])
        title_words: List[str] = []
        for w in after_code.split():
            if _is_admin_word(w) or re.match(r'^\d', w):
                break
            if ':' in w:
                base = w.rstrip(':').lower()
                if base in _COLON_ADMIN:
                    break
                # Non-admin colon: include the word (stripped of colon) and stop
                title_words.append(w.rstrip(':'))
                break
            title_words.append(w)
            if len(title_words) >= 10:
                break
        if len(title_words) >= 2:
            title = _clean_title(' '.join(title_words))
            if title:
                return title

    # ── Pass 3: no-space SUMA CamelCase ──────────────────────────────────────
    # "MasterofScienceinSustainabilityManagementSUMAPS5060SolarProjectDevelopmentDates:TBD"
    for line in lines[:5]:
        m = re.search(
            r'SUMA\s*PS\s*\d{3,5}(?:[A-Z](?=[:\-\s]))?[:\-\s]*'
            r'([A-Za-z][^\d\n]{5,120}?)'
            r'(?:\s+TBD|\s*Dates?:|\s*Day[s/:]|\d+\s*[Cc]redit'
            r'|Location:|Office|Instructor|Email'
            r'|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)',
            line, re.IGNORECASE
        )
        if not m:
            continue
        raw = m.group(1).strip().rstrip(',:').strip()
        # Remove leading dash/separator
        raw = re.sub(r'^[-–—_\s]+', '', raw)
        # Two-step CamelCase split
        spaced = _split_camelcase(raw)
        words = spaced.split()
        # Drop trailing admin words
        while words and _is_admin_word(words[-1]):
            words.pop()
        if len(words) >= 2:
            title = _clean_title(' '.join(words))
            if title and len(title) > 4:
                return title

    # ── Pass 4: compact course-code anchor ───────────────────────────────────
    # Title precedes a compact code (no space between letters and digits):
    # "Computing and Research Methods for Climate Data Science CLMT5045G001"
    # "Global Immersion Program: Green Industrial Policy in Europe BUSIB8712"
    for line in lines[:10]:
        m = re.search(r'\s+[A-Z]{3,8}\d{3,5}[A-Z]{0,3}\b', line)
        if not m:
            continue
        candidate = line[:m.start()].strip()
        candidate = re.sub(r'^[^A-Za-z]+', '', candidate)
        # Strip any leading institution phrase before the real title
        candidate = re.sub(
            r'^(?:Master\s+of\s+Science.*?Management|Industry\s+Immersion\s+Program|'
            r'Global\s+Immersion\s+Program|Course\s+Syllabus:\s*)\s*',
            '', candidate, flags=re.IGNORECASE
        )
        # Strip trailing semester/year
        candidate = _SEMESTER_RE.sub('', candidate).strip()
        words = candidate.split()
        if len(words) < 2 or len(words) > 14:
            continue
        if re.search(r'[|@\\]', candidate):
            continue
        admin_ct = sum(1 for w in words if _is_admin_word(w.rstrip(':,')))
        if admin_ct > len(words) // 2:
            continue
        title = _clean_title(candidate)
        if title and len(title.split()) >= 2:
            return title

    # ── Pass 5: "Title Syllabus Year" pattern ────────────────────────────────
    # "Environmental Law, Policy, and Decision-making Syllabus Spring 2026"
    m = re.search(
        r'^([A-Za-z][a-zA-Z\s,\-/&\']{10,100}?)\s+(?:Syllabus|Course\s+Outline)\b',
        text[:500], re.IGNORECASE | re.MULTILINE
    )
    if m:
        candidate = m.group(1).strip()
        words = candidate.split()
        if 2 <= len(words) <= 10:
            # Must look like a title: mostly capitalised non-stop words, no admin words
            non_stop = [w for w in words if w.lower().rstrip(',:') not in _STOP_WORDS]
            cap_ct = sum(1 for w in non_stop if w and w[0].isupper())
            if non_stop and cap_ct / len(non_stop) >= 0.6:
                admin_ct = sum(1 for w in words if _is_admin_word(w.rstrip(':,')))
                if admin_ct == 0:
                    title = _clean_title(candidate)
                    if title and len(title.split()) >= 2:
                        return title

    # ── Pass 6: filename fallback ─────────────────────────────────────────────
    if filename:
        return extract_course_title_from_filename(filename)

    return None
