"""
Lightweight intent classifier for user messages.
Uses regex pattern matching — zero latency, no LLM call.
"""
import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class IntentResult:
    """Result of intent classification."""
    intent: str          # Machine key: "summarize", "case_study", etc.
    label: str           # Display label: "Summary", "Case Study", etc.
    prompt_suffix: str   # Appended to system prompt
    use_knowledge_base: bool = True  # Whether to query Pinecone
    preferred_provider: Optional[str] = None  # Override user-selected provider if set
    max_tokens: Optional[int] = None  # Per-intent token budget override; None = use request default


# Citation format rule injected into every intent prompt.
_CITATION_POLICY = (
    "Citation format: place an inline [N] marker immediately after every claim drawn from a "
    "retrieved source (e.g. 'Emissions fell 12% between 2010 and 2020 [1][3]'). "
    "For reasoning that bridges multiple sources, use [AI:N,M]. "
    "For claims from general model knowledge not present in the retrieved sources, use [AI]. "
    "NEVER write 'Source 1', 'Source 2', 'the document', or 'according to the sources' in prose — "
    "use bracket markers only. Every factual claim must carry at least one marker."
)


# Intent definitions: (intent_key, display_label, patterns, prompt_suffix)
INTENT_DEFINITIONS = [
    {
        "intent": "summarize",
        "label": "Summary",
        "preferred_provider": "mistral",
        "patterns": [
            r"\bsummar(y|ize|ise)\b",
            r"\boverview\b",
            r"\bwhat is this (about|document)\b",
            r"\bkey (points|takeaways|findings)\b",
            r"\btl;?dr\b",
            r"\bgist\b",
            r"\bhigh[- ]?level\b",
            r"\bmain (ideas?|themes?|points?)\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Summary\n"
            "Structure your response with clear markdown headings:\n"
            "### Key Findings\n"
            "- Bullet the most important findings or claims (3-5 points)\n"
            "### Methodology\n"
            "- Briefly describe the approach, data sources, or framework used\n"
            "### Implications\n"
            "- What does this mean for climate policy, education, or practice?\n"
            "### Limitations\n"
            "- Note any caveats, gaps, or scope boundaries\n\n"
            "Use precise language. Distinguish between evidence-backed claims and interpretive statements.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        "intent": "explain",
        "label": "Explainer",
        "preferred_provider": "claude",
        "patterns": [
            r"\bexplain\b",
            r"\bsimpl(er|ify|e terms)\b",
            r"\bbreak (it |this )?down\b",
            r"\bwhat does .+ mean\b",
            r"\bdefine\b",
            r"\bin (plain|simple|layman|everyday) (terms|language|words)\b",
            r"\bhelp me understand\b",
            r"\bwhat is .+ in the context\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Explanation\n"
            "Write for someone encountering this topic for the first time:\n"
            "- Define all technical terms inline using parenthetical definitions\n"
            "- Use concrete analogies to ground abstract concepts\n"
            "- Build from foundational ideas to complex ones\n"
            "- Use short paragraphs (2-3 sentences max)\n"
            "- Highlight cause-and-effect relationships explicitly\n"
            "- End with a 'Key Takeaway' sentence that captures the core idea\n\n"
            "Avoid jargon without explanation. If a term is domain-specific, explain it.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        "intent": "compare",
        "label": "Comparison",
        "preferred_provider": "mistral",
        "patterns": [
            r"\bcompar(e|ison|ing)\b",
            r"\bdifferen(ce|t|ces|tiate)\b",
            r"\bcontrast\b",
            r"\bversus\b|\bvs\.?\b",
            r"\bhow (does|do) .+ differ\b",
            r"\bsimilarit(y|ies)\b",
            r"\brelat(e|ionship) between\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Comparison\n"
            "Structure your comparison clearly:\n"
            "### Dimensions of Comparison\n"
            "- Identify the key dimensions or criteria being compared\n"
            "### Analysis\n"
            "- For each dimension, present both sides with evidence from sources\n"
            "- Use a markdown table if comparing more than 2 items across 3+ dimensions\n"
            "### Synthesis\n"
            "- What patterns emerge? Where do they converge or diverge?\n"
            "- What are the practical implications of these differences?\n\n"
            "Be balanced — present each perspective with equal rigor.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        "intent": "case_study",
        "label": "Case Study",
        "preferred_provider": "mistral",
        "patterns": [
            r"\bcase stud(y|ies)\b",
            r"\breal[- ]?world example\b",
            r"\bpractical (example|application|scenario)\b",
            r"\bapplication of\b",
            r"\bhow (is|are|was|were) .+ (used|applied|implemented)\b",
            r"\bin practice\b",
            r"\bscenario\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Case Study\n"
            "Frame your response as a structured case study:\n"
            "### Context\n"
            "- Setting, timeframe, and relevant background\n"
            "### Stakeholders\n"
            "- Who is involved and what are their roles or interests?\n"
            "### Key Challenge\n"
            "- What problem or question is being addressed?\n"
            "### Evidence & Analysis\n"
            "- What do the sources reveal? Include data points where available\n"
            "### Outcomes\n"
            "- What happened? What were the results or lessons learned?\n"
            "### Discussion Questions\n"
            "- Pose 2-3 questions suitable for classroom discussion\n\n"
            "Ground all claims in the source material. Flag any inferences clearly.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        # Authoring intent: user wants to BUILD a new case document from scratch,
        # modeled after or inspired by a reference case. Distinct from case_study
        # (which analyzes an existing case). Triggers on construction verbs + "case".
        # Invariant: matched BEFORE case_study in the list so "build a case study"
        # routes here rather than to the analysis intent.
        "intent": "create_case",
        "label": "Case Builder",
        "preferred_provider": "claude",
        "max_tokens": 12000,
        "patterns": [
            r"\b(build|create|write|draft|develop|construct|generate|produce) (a |an |the |this |new |full |complete |entire )?(new |full |complete |entire )?case\b",
            r"\bmimick(ing)?\b",
            r"\bmodeled? after\b",
            r"\bfrom scratch\b",
            r"\bnew case\b",
            r"\boriginal case\b",
            r"\bcreate .*(foak|first.of.a.kind)\b",
            r"\b(foak|first.of.a.kind).*(case|study)\b",
        ],
        "prompt_suffix": (
            "\n\n## Task — Build a Full Case Study Document\n"
            "You are authoring a complete, publication-quality case study modeled after the reference "
            "material provided. Write the ENTIRE document in a single response. Do NOT stop mid-section.\n\n"
            "Follow this structure (adapt section names to fit the subject matter):\n"
            "1. **Title & Header** — Title, date, location, authorship note\n"
            "2. **Introduction** — Opening scene, protagonist, project overview, key decision at stake\n"
            "3. **Context** — Industry/technology background, market conditions, regulatory environment\n"
            "4. **Technology Overview** — How the technology works, advantages, limitations, FOAK risks\n"
            "5. **The Project** — Specifications, timeline, site selection, construction narrative\n"
            "6. **Environmental & Regulatory Challenges** — Permitting, stakeholder conflicts, mitigations\n"
            "7. **Financing Structure** — Capital stack table, debt/equity/grants, offtake agreements\n"
            "8. **Risk Analysis** — Technology, market, regulatory, financial risks with mitigations\n"
            "9. **Business Model** — Revenue streams, PPA structure, competitive positioning\n"
            "10. **Outcomes & Lessons** — What happened, what worked, what did not\n"
            "11. **Discussion Questions** — 3-5 questions for classroom use\n\n"
            "Authoring rules:\n"
            "- Write in narrative prose, not bullet points — this is a document, not a Q&A\n"
            "- Use the reference case structure and tone as a template\n"
            "- Include specific numbers, dates, names, and data where available from sources\n"
            "- Clearly label any invented or extrapolated details with [AI]\n"
            "- Do NOT truncate or summarize sections — complete every section fully\n"
            "- If the response approaches the output limit, finish the current section cleanly "
            "and add a note '## [Continued — request next section]' so the user knows to ask for more\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        "intent": "generate_questions",
        "label": "Assessment",
        "preferred_provider": "claude",
        "patterns": [
            r"\b(generate|create|write|give me|suggest|come up with) .*(questions?|quiz|exam|test|assessment)\b",
            r"\bquiz me\b",
            r"\btest me\b",
            r"\bquestions? (about|on|for|from)\b",
            r"\bassessment\b",
            r"\bexam (prep|questions?)\b",
            r"\bstudy (guide|questions?)\b",
            r"\bwhat questions? could\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Assessment Questions\n"
            "Generate questions at multiple cognitive levels (Bloom's Taxonomy):\n"
            "### Recall & Comprehension\n"
            "- 2-3 questions testing factual knowledge and understanding\n"
            "### Application & Analysis\n"
            "- 2-3 questions requiring application to new scenarios or analytical reasoning\n"
            "### Synthesis & Evaluation\n"
            "- 1-2 questions requiring integration of multiple concepts or critical evaluation\n"
            "### Answer Key\n"
            "- Provide concise model answers or key points for each question\n"
            "- Each answer must end with citation marker(s): [N] for direct source, [AI:N,M] for bridged reasoning across sources, [AI] for general model knowledge. Markers are tokens only — never write [AI: text] or [AI: explanation].\n\n"
            "Questions should be specific to the source content, not generic. "
            "Include the cognitive level label in parentheses after each question.\n\n"
            "Citation policy for questions: After each question, append the source citation(s) that the question is derived from:\n"
            "- Use [N] if the question is directly grounded in a specific retrieved source\n"
            "- Use [AI:N,M] if the question bridges reasoning across multiple sources\n"
            "- Use [AI] if the question draws on general model knowledge not present in the retrieved sources\n"
            "IMPORTANT: Citation markers must be tokens only — [1], [AI], [AI:1,3] — never add text inside the brackets. Do NOT write [AI: explanation] or [AI: text here].\n"
            "Every question must end with at least one citation marker.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        "intent": "critique",
        "label": "Critique",
        "preferred_provider": "claude",
        "patterns": [
            r"\bcritiqu(e|ing)\b",
            r"\bweakness(es)?\b",
            r"\blimitation(s)?\b",
            r"\bstrength(s)?\b",
            r"\bgap(s)? in\b",
            r"\bbias(es)?\b",
            r"\bshortcoming(s)?\b",
            r"\bcritical (analysis|review|assessment)\b",
            r"\bevaluat(e|ion)\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Critical Analysis\n"
            "Provide a balanced critical assessment:\n"
            "### Strengths\n"
            "- What does this do well? What is the strongest evidence or argument?\n"
            "### Weaknesses & Gaps\n"
            "- What is missing, underdeveloped, or potentially biased?\n"
            "- Are there methodological concerns?\n"
            "### Alternative Perspectives\n"
            "- What would critics or other schools of thought say?\n"
            "### Overall Assessment\n"
            "- Weigh the strengths against weaknesses\n"
            "- How should a reader calibrate their confidence in the claims?\n\n"
            "Distinguish between factual gaps and interpretive disagreements.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        "intent": "methodology",
        "label": "Methodology",
        "preferred_provider": "claude",
        "patterns": [
            r"\bmethodolog(y|ies|ical)\b",
            r"\bresearch (design|method|approach)\b",
            r"\bhow (did|do) they (study|research|measure|collect|analyze)\b",
            r"\bdata (collection|source|set)\b",
            r"\bsampl(e|ing)\b",
            r"\bexperimental (design|setup)\b",
            r"\bframework\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Methodology Review\n"
            "Describe the research methodology clearly:\n"
            "### Research Design\n"
            "- What type of study is this? (qualitative, quantitative, mixed methods, meta-analysis, etc.)\n"
            "### Data & Sources\n"
            "- What data was collected or used? What is the sample/scope?\n"
            "### Analytical Approach\n"
            "- How was the data analyzed? What tools or frameworks were applied?\n"
            "### Validity & Reliability\n"
            "- How robust is the methodology? Any concerns about generalizability?\n\n"
            "Be specific about what the sources actually describe vs. what you are inferring.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
    {
        "intent": "lesson_plan",
        "label": "Lesson Plan",
        "preferred_provider": "mistral",
        "patterns": [
            r"\blesson plan\b",
            r"\bteaching (plan|strategy|approach|activity|activities)\b",
            r"\bhow (to|would you|should I) teach\b",
            r"\bclassroom (activity|activities|exercise|discussion)\b",
            r"\bcurriculum\b",
            r"\blearning (objectives?|outcomes?|goals?)\b",
            r"\bcourse (design|structure|outline)\b",
            r"\bpedagog(y|ical)\b",
            r"\binstructional\b",
        ],
        "prompt_suffix": (
            "\n\n## Output Structure — Lesson Plan\n"
            "Design a practical teaching resource:\n"
            "### Learning Objectives\n"
            "- 2-4 specific, measurable objectives (use action verbs)\n"
            "### Key Concepts\n"
            "- List the core concepts students should understand\n"
            "### Teaching Activities\n"
            "- Describe 2-3 activities with format (lecture, discussion, group work, etc.)\n"
            "- Include estimated time for each\n"
            "### Discussion Prompts\n"
            "- 3-4 open-ended questions to drive classroom conversation\n"
            "### Assessment Ideas\n"
            "- How could instructors evaluate student understanding?\n"
            "### Recommended Readings\n"
            "- Reference relevant sources from the documents\n\n"
            "Target a graduate-level audience unless otherwise specified.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact."
        ),
    },
]

# Append citation policy to every intent's prompt_suffix.
for _defn in INTENT_DEFINITIONS:
    _defn["prompt_suffix"] = _defn["prompt_suffix"].rstrip() + "\n\n" + _CITATION_POLICY


# ---------------------------------------------------------------------------
# Knowledge-base routing: when the user has attachments, decide whether to
# also query Pinecone or rely solely on the attached files.
# ---------------------------------------------------------------------------

# Patterns that signal the user is asking about their OWN attached documents.
_ATTACHMENT_ONLY_PATTERNS = [
    r"\b(this|these|the|my) \d* *(document|file|attachment|upload|paper|syllab|pdf|case)",
    r"\bwhat (is|are) (this|these|it|they) about\b",
    r"\b(tell me|what) about (this|these|the) (document|file|paper|syllab|case)",
    r"\buploaded (document|file|paper|syllab|case)",
    r"\b(read|analyze|review|parse|look at) (this|these|the|my) (document|file|paper|attachment|syllab|case)",
    r"\b(what does|what do) (this|these|the|my) (document|file|paper|syllab|case)",
    r"\b(this|these) \d+ (document|file|paper|syllab|case)",
    r"\bin (this|these|the|my) (document|file|paper|attachment|syllab|case)",
    # Explicit reference phrases — user points at something they attached
    r"\breferring to this\b",
    r"\bbased on this (document|file|case|paper|attachment)?\b",
    r"\busing this (document|file|case|paper|attachment)?\b",
    r"\bfrom this (document|file|case|paper|attachment)?\b",
    r"\bthe attached (document|file|case|paper)\b",
    r"\bthe (document|file|case|paper) (i |I )?(attached|uploaded|shared|provided)\b",
    r"\bthis attached\b",
    r"\bthis case (i|I) (attached|shared|uploaded|provided)\b",
]

# Patterns that signal the user wants cross-referencing against the knowledge base.
_KNOWLEDGE_BASE_PATTERNS = [
    r"\bwho else\b",
    r"\bwhat (other|else)\b",
    r"\bother (course|professor|instructor|syllab|document|paper|reading)",
    r"\bsimilar (to|course|topic|reading|content)",
    r"\bfind (similar|related|others|matching)",
    r"\bacross (the|all|our)\b",
    r"\bin (the|our) (database|knowledge|collection|corpus|system)",
    r"\bcompare (with|to|against) (other|the|existing)",
    r"\bwho (teaches|covers|has|offers)\b",
    r"\bknowledge base\b",
]


def _should_use_knowledge_base(message: str) -> bool:
    """Decide whether to query Pinecone when attachments are present.

    Priority:
    1. Explicit knowledge-base patterns → True  (search Pinecone)
    2. Attachment-only patterns → False           (skip Pinecone)
    3. No match → True                            (safe default)
    """
    lower = message.lower().strip()

    for pattern in _KNOWLEDGE_BASE_PATTERNS:
        if re.search(pattern, lower):
            return True

    for pattern in _ATTACHMENT_ONLY_PATTERNS:
        if re.search(pattern, lower):
            return False

    return True  # safe default — still search


def classify_intent(message: str, has_attachments: bool = False) -> IntentResult:
    """
    Classify the user's message into an intent category.
    Returns the first matching intent, or a general fallback.

    Uses case-insensitive regex matching — zero latency.

    When *has_attachments* is True, also determines whether the question
    targets the user's own files (skip Pinecone) or needs the broader
    knowledge base (query Pinecone).
    """
    message_lower = message.lower().strip()

    use_kb = True
    if has_attachments:
        use_kb = _should_use_knowledge_base(message)

    for definition in INTENT_DEFINITIONS:
        for pattern in definition["patterns"]:
            if re.search(pattern, message_lower):
                return IntentResult(
                    intent=definition["intent"],
                    label=definition["label"],
                    prompt_suffix=definition["prompt_suffix"],
                    use_knowledge_base=use_kb,
                    preferred_provider=definition.get("preferred_provider"),
                    max_tokens=definition.get("max_tokens"),
                )

    # Fallback: generalist agent — comprehensive, well-structured responses
    return IntentResult(
        intent="generalist",
        label="Generalist",
        preferred_provider="mistral",
        prompt_suffix=(
            "\n\nProvide a comprehensive, well-structured response:\n"
            "- Lead with a clear, concise answer to the user's question\n"
            "- Expand with relevant evidence, context, or reasoning from the sources\n"
            "- Use bullet points or numbered lists for multiple supporting points\n"
            "- Use tables when comparing options, frameworks, data, or features across dimensions\n"
            "- Use bold text to highlight key terms, conclusions, or important findings\n"
            "- Connect the answer to wider themes, implications, or related concepts where appropriate\n"
            "- End with a brief synthesis or actionable insight\n\n"
            "Do NOT use section headers like 'Direct Answer' or 'Key Takeaway' in your response.\n\n"
            "Adapt depth to the complexity of the question. Simple questions deserve concise answers; "
            "complex questions warrant thorough exploration. Always ground claims in source material.\n\n"
            "Apply the inference policy: ground all factual claims in retrieved sources; "
            "state any gaps clearly; label causal bridge connections explicitly rather than presenting them as established fact.\n\n"
        ) + _CITATION_POLICY,
        use_knowledge_base=use_kb,
    )
