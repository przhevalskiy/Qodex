from abc import ABC, abstractmethod
from typing import AsyncGenerator, Dict, List, Optional, Type
from app.models.message import Message


class BaseProvider(ABC):
    """Abstract base class for AI providers."""

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the name of the provider."""
        pass

    @abstractmethod
    async def stream_completion(
        self,
        messages: List[Message],
        context: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        intent_prompt: Optional[str] = None,
        research_prompt: Optional[str] = None,
        image_attachments: Optional[List[Dict]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Stream a completion response.

        Args:
            messages: List of conversation messages
            context: Optional RAG context to include
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            intent_prompt: Optional intent-specific prompt suffix to append to system message
            research_prompt: Optional research depth prompt to control response thoroughness

        Yields:
            String chunks of the response
        """
        pass

    @abstractmethod
    async def generate_suggested_questions(
        self,
        conversation_history: List[Dict[str, str]],
        last_response: str,
        count: int = 5
    ) -> List[str]:
        """
        Generate suggested follow-up questions based on conversation context.

        Args:
            conversation_history: List of message dicts with 'role' and 'content'
            last_response: The assistant's most recent response
            count: Number of questions to generate (default 5)

        Returns:
            List of suggested question strings (max `count` items)
        """
        pass

    def _format_messages_for_api(
        self,
        messages: List[Message],
        context: Optional[str] = None,
        intent_prompt: Optional[str] = None,
        research_prompt: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """Format messages for the API, optionally including context with citation instructions."""
        formatted = []

        # Add system message with context if provided
        if context:
            # Detect whether context includes Pinecone sources or only user attachments.
            # Attachment-only context uses [Attached File: ...] labels;
            # Pinecone sources use [Source N - ...] labels.
            has_pinecone_sources = "[Source " in context

            if has_pinecone_sources:
                system_content = (
                    "Use the following context to help answer the user's question. "
                    "Each source is numbered. When you reference information from a specific source, "
                    "add a citation marker [N] immediately after the relevant statement, where N is the source number.\n\n"
                    "[Sources for reference]\n"
                    f"{context}\n\n"
                    "Guidelines:\n"
                    "- ONLY use citation numbers that match the [Source N] headers listed above\n"
                    "- Do NOT invent citation numbers or use reference/footnote numbers from inside the source text\n"
                    "- Add [N] citations inline where information comes from source N\n"
                    "- Multiple sources can be cited together like [1][2]\n"
                    "- Be precise - cite at the claim level, not just at the end of paragraphs\n"
                    "- Natural placement - citations should feel unobtrusive\n"
                    "- When adding context, explanation, or reasoning not directly supported by the retrieved sources, label it with [AI:N,M] or [AI] (see below)\n\n"
                    "INFERENCE POLICY — Two tiers:\n"
                    "Tier 1 — Grounded facts (inference prohibited): All factual claims must come directly from retrieved sources. "
                    "If no source explicitly covers the queried entity or topic, state that gap clearly — do not construct an answer to fulfill the request.\n"
                    "Tier 2 — Causal bridge inference (permitted, must be attributed): If sources contain related material with meaningful "
                    "conceptual overlap to the query, you MAY draw explicit causal connections — clearly marked as inference with the "
                    "reasoning chain shown. Mark all such connections with [AI:N,M] where N,M are the source numbers you reasoned from.\n"
                    "- Never present bridge inference or general knowledge as established fact\n"
                    "- Never use inference to answer a direct factual query the sources don't support\n"
                    "- The conversation history that follows is for continuity only\n"
                    "- Do NOT reuse specific facts, names, or claims from your earlier responses — base all claims on current sources above\n\n"
                    "REQUIRED — Inference & Knowledge Attribution:\n"
                    "Every sentence that uses explanation, analogy, reasoning, or general knowledge NOT directly quoted from a source MUST be labeled:\n"
                    "  [AI:N,M] — causal bridge inference derived from and traceable to sources N and M. List all source numbers you reasoned from.\n"
                    "  [AI] — pure general training knowledge with no link to any retrieved source.\n"
                    "- Use [AI:N,M] when your inference extends or connects concepts explicitly found in specific retrieved sources.\n"
                    "- Use [AI] when the statement comes entirely from general training knowledge.\n"
                    "- Do NOT apply [AI:N,M] or [AI] to factual claims already cited with [N].\n"
                    "- Apply at the sentence level, inline — not only at paragraph ends.\n"
                    "Examples:\n"
                    "  'Carbon credits function like tradeable permits for emissions. [AI]'\n"
                    "  'This regulatory structure suggests companies prioritize cheaper offsets first. [AI:2,3]'\n\n"
                    "Now provide an accurate and helpful response with inline citations."
                )
            else:
                # Attachment-only mode: no numbered citations, reference files by name
                system_content = (
                    "The user has attached documents to this conversation for you to analyze. "
                    "Use the content below to answer their question.\n\n"
                    "[Attached Documents]\n"
                    f"{context}\n\n"
                    "Guidelines:\n"
                    "- Reference documents by their filename when discussing specific content\n"
                    "- Provide thorough, accurate analysis grounded in the attached content\n"
                    "- Do NOT use numbered citation markers like [1] or [2]\n"
                    "- If the documents don't contain enough information to answer, say so explicitly\n"
                    "- Do NOT carry forward specific facts from your earlier responses — "
                    "base all claims on the attached content above\n\n"
                    "Now provide a helpful response based on the attached documents."
                )

            # Append research depth instructions (controls thoroughness)
            if research_prompt:
                system_content += research_prompt

            # Append intent-specific output structure if present
            if intent_prompt:
                system_content += intent_prompt

            formatted.append({
                "role": "system",
                "content": system_content
            })

        # Add conversation messages (filter out empty messages)
        for msg in messages:
            if msg.content and msg.content.strip():
                formatted.append({
                    "role": msg.role.value,
                    "content": msg.content
                })

        return formatted


class ProviderRegistry:
    """Registry for AI providers."""

    _providers: Dict[str, Type[BaseProvider]] = {}
    _instances: Dict[str, BaseProvider] = {}

    @classmethod
    def register(cls, name: str, provider_class: Type[BaseProvider]) -> None:
        """Register a provider class."""
        cls._providers[name.lower()] = provider_class

    @classmethod
    def get_provider(
        cls, name: str, api_key: str, model: str
    ) -> BaseProvider:
        """Get or create a provider instance."""
        cache_key = f"{name}:{model}"

        if cache_key not in cls._instances:
            provider_class = cls._providers.get(name.lower())
            if not provider_class:
                raise ValueError(f"Unknown provider: {name}")
            cls._instances[cache_key] = provider_class(api_key, model)

        return cls._instances[cache_key]

    @classmethod
    def list_providers(cls) -> List[str]:
        """List all registered provider names."""
        return list(cls._providers.keys())

    @classmethod
    def clear_instances(cls) -> None:
        """Clear cached provider instances."""
        cls._instances.clear()
