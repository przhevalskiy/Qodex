from typing import AsyncGenerator, List, Optional, Dict
from anthropic import AsyncAnthropic
import json

from app.models.message import Message
from .base import BaseProvider, ProviderRegistry


class ClaudeProvider(BaseProvider):
    """Anthropic Claude API provider implementation."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-5-20250929"):
        super().__init__(api_key, model)
        self.client = AsyncAnthropic(api_key=api_key)

    @property
    def provider_name(self) -> str:
        return "claude"

    async def stream_completion(
        self,
        messages: List[Message],
        context: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        intent_prompt: Optional[str] = None,
        research_prompt: Optional[str] = None,
        image_attachments: Optional[List[Dict]] = None,
        stream_metadata: Optional[Dict] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream completion from Claude."""
        # Claude uses a different message format
        system_message = None
        formatted_messages = []

        if context:
            system_message = (
                "Use the following context to help answer the user's question. "
                "Each source is numbered. When you reference information from a specific source, "
                "add a citation marker [N] immediately after the relevant statement, where N is the source number.\n\n"
                "[Sources for reference]\n"
                f"{context}\n\n"
                "Guidelines:\n"
                "- ONLY use citation numbers that match the [Source N] headers listed above\n"
                "- Do NOT use numbered references found inside the source documents (e.g. bibliographies, footnotes like [31] or [54]) — those are internal to the documents, not valid citation numbers\n"
                "- Add [N] citations inline where information comes from source N\n"
                "- Multiple sources can be cited together like [1][2]\n"
                "- Be precise - cite at the claim level, not just at the end of paragraphs\n"
                "- Natural placement - citations should feel unobtrusive\n"
                "- Cite from ALL sources that contain relevant information — do not omit retrieved sources that support the answer\n"
                "- When adding context, explanation, or reasoning not directly supported by the retrieved sources, label it with [AI:N,M] or [AI] (see below)\n\n"
                "INFERENCE POLICY — Two tiers:\n"
                "Tier 1 — Grounded facts (inference prohibited): All factual claims must come directly from retrieved sources. "
                "If no source explicitly covers the queried entity or topic, state that gap clearly — do not construct an answer to fulfill the request.\n"
                "Tier 2 — Causal bridge inference (permitted, must be attributed): If sources contain related material with meaningful "
                "conceptual overlap to the query, you MAY draw explicit causal connections — clearly marked as inference with the "
                "reasoning chain shown. Mark all such connections with [AI:N,M] where N,M are the source numbers you reasoned from.\n"
                "- Never present bridge inference or general knowledge as established fact\n"
                "- Never use inference to answer a direct factual query the sources don't support\n"
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

            # Append research depth instructions (controls thoroughness)
            if research_prompt:
                system_message += research_prompt

            # Append intent-specific output structure if present
            if intent_prompt:
                system_message += intent_prompt

        for msg in messages:
            # Skip empty messages
            if not msg.content or not msg.content.strip():
                continue

            if msg.role.value == "system":
                # Combine system messages
                if system_message:
                    system_message = f"{system_message}\n\n{msg.content}"
                else:
                    system_message = msg.content
            else:
                formatted_messages.append({
                    "role": msg.role.value,
                    "content": msg.content
                })

        # Ensure we have at least one user message
        if not formatted_messages:
            formatted_messages = [{"role": "user", "content": "Hello"}]

        # Inject image attachments as vision content blocks into the last user message
        if image_attachments:
            last = formatted_messages[-1]
            if last["role"] == "user":
                content_blocks = [{"type": "text", "text": last["content"]}]
                for img in image_attachments:
                    content_blocks.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": img["media_type"],
                            "data": img["base64"],
                        },
                    })
                formatted_messages[-1] = {"role": "user", "content": content_blocks}

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            system=system_message or "",
            messages=formatted_messages,
            temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text
            # Capture stop reason after stream completes
            if stream_metadata is not None:
                final = await stream.get_final_message()
                stream_metadata['stop_reason'] = final.stop_reason  # "end_turn" or "max_tokens"

    async def generate_suggested_questions(
        self,
        conversation_history: List[Dict[str, str]],
        last_response: str,
        count: int = 5
    ) -> List[str]:
        """Generate suggested follow-up questions using Claude."""
        try:
            system_prompt = f"""Based on this conversation, suggest {count} relevant follow-up questions the user might ask.

Return ONLY a JSON array of question strings, nothing else.
Example: ["Question 1?", "Question 2?", "Question 3?"]

Guidelines:
- Questions should be natural and conversational
- Focus on clarifying details, exploring related topics, or going deeper
- Keep questions concise (under 15 words)
- Make them specific to the conversation context"""

            messages = [
                *conversation_history[-6:],
                {"role": "assistant", "content": last_response},
                {"role": "user", "content": "Generate suggested follow-up questions."}
            ]

            response = await self.client.messages.create(
                model="claude-haiku-4-5-20251001",  # Fast model
                system=system_prompt,
                messages=messages,
                temperature=0.7,
                max_tokens=200
            )

            content = response.content[0].text.strip()

            # Try to extract JSON array from response
            if content.startswith('```'):
                lines = content.split('\n')
                content = '\n'.join(lines[1:-1]) if len(lines) > 2 else content
                content = content.replace('```json', '').replace('```', '').strip()

            questions = json.loads(content)

            if isinstance(questions, list):
                return [q for q in questions if isinstance(q, str)][:count]

            return []

        except Exception as e:
            print(f"Failed to generate suggested questions (Claude): {e}")
            return []


# Register the provider
ProviderRegistry.register("claude", ClaudeProvider)
