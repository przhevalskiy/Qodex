"""
Research Mode Configuration - Single source of truth for research depth settings.

Defines three research modes with different top_k values and prompt enhancements:
- Quick (7 sources): Fast, focused answers
- Enhanced (12 sources): Balanced depth with multiple perspectives
- Deep Research (16 sources): Exhaustive scholarly analysis
"""
from dataclasses import dataclass
from enum import Enum
from typing import Dict


class ResearchMode(str, Enum):
    """Research mode identifiers."""
    QUICK = "quick"
    ENHANCED = "enhanced"
    DEEP = "deep"


@dataclass
class ResearchModeConfig:
    """Configuration for a research mode."""
    mode: ResearchMode
    label: str              # Display name for UI
    description: str        # UI tooltip/description
    top_k: int              # Number of sources to retrieve
    min_score: float        # Minimum cosine similarity to include a source
    prompt_enhancement: str # Additional system prompt instructions


RESEARCH_MODE_DEFINITIONS: Dict[ResearchMode, ResearchModeConfig] = {
    ResearchMode.QUICK: ResearchModeConfig(
        mode=ResearchMode.QUICK,
        label="Focused",
        description="Searches for the most directly relevant sources",
        top_k=7,
        min_score=0.40,
        prompt_enhancement=(
            "\n\n## Research Depth: Quick\n"
            "Provide a focused, efficient response:\n"
            "- Prioritize the most relevant and authoritative sources\n"
            "- Give direct answers with key supporting evidence\n"
            "- Keep synthesis concise - focus on main findings\n"
            "- Use 2-4 citations for the most important claims"
        ),
    ),
    ResearchMode.ENHANCED: ResearchModeConfig(
        mode=ResearchMode.ENHANCED,
        label="Broad",
        description="Wider search including adjacent and related sources",
        top_k=12,
        min_score=0.30,
        prompt_enhancement=(
            "\n\nProvide a thorough, well-structured response that draws from as many sources as possible. "
            "Go beyond the surface — include supporting evidence, relevant context, and connections "
            "between sources. Note where sources agree or diverge. Synthesize across sources to "
            "identify patterns and build a comprehensive picture.\n\n"
            "Use structured formatting to make the response easy to scan:\n"
            "- Use bullet points or numbered lists for key findings, comparisons, or takeaways\n"
            "- Use tables when comparing data, frameworks, or options across multiple dimensions\n"
            "- Use bold text for important terms or conclusions\n"
            "- Break the response into clear sections with descriptive subheadings\n\n"
            "Use 4-8 citations distributed across your response. "
            "Draw from the broadest range of provided sources — do not rely on just 2-3."
        ),
    ),
    ResearchMode.DEEP: ResearchModeConfig(
        mode=ResearchMode.DEEP,
        label="Exploratory",
        description="Widest search for open-ended discovery and analysis",
        top_k=20,
        min_score=0.25,
        prompt_enhancement=(
            "\n\nProvide an exhaustive, scholarly-level response. This should read like a "
            "thorough research briefing. Conduct a comprehensive review across all available sources. "
            "Present nuanced analysis with multiple perspectives and competing viewpoints.\n\n"
            "Use structured formatting throughout to make the response scannable and rigorous:\n"
            "- Use bullet points or numbered lists for key findings, evidence, and takeaways\n"
            "- Use tables when comparing data, frameworks, methodologies, or options across dimensions\n"
            "- Use bold text for important terms, conclusions, or critical findings\n"
            "- Break the response into clear thematic sections with descriptive subheadings\n\n"
            "Identify methodological approaches, strengths, and limitations in the source material. "
            "Synthesize findings into coherent themes, noting gaps and areas of uncertainty. "
            "Discuss implications for policy, practice, or further research where relevant.\n\n"
            "Use extensive citations (8+) distributed across the response to ground every major claim. "
            "Draw from the broadest range of provided sources — do not rely on just 2-3. "
            "Aim for maximum depth and rigor."
        ),
    ),
}


# Default mode for new requests
DEFAULT_RESEARCH_MODE = ResearchMode.QUICK


def get_research_mode_config(mode: ResearchMode) -> ResearchModeConfig:
    """Get configuration for a research mode."""
    return RESEARCH_MODE_DEFINITIONS[mode]


def get_default_top_k() -> int:
    """Get the default top_k value (for backward compatibility)."""
    return RESEARCH_MODE_DEFINITIONS[DEFAULT_RESEARCH_MODE].top_k


def list_research_modes() -> list:
    """List all research modes with their configurations (for API endpoint)."""
    return [
        {
            "mode": config.mode.value,
            "label": config.label,
            "description": config.description,
            "top_k": config.top_k,
            "is_default": config.mode == DEFAULT_RESEARCH_MODE,
        }
        for config in RESEARCH_MODE_DEFINITIONS.values()
    ]
