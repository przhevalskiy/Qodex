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
                "SYLLABUS RULE — When retrieved sources are course syllabi, reading lists, or curriculum documents:\n"
                "- Do NOT generate content about the materials they reference (case studies, papers, books, projects)\n"
                "- Instead, surface and list what those syllabi reference — title, author, topic, and which source it appears in\n"
                "- Example: if asked for a case study and a syllabus references 'Empire State Building retrofit (Akason 2012)', "
                "respond with: 'The curriculum references the following case studies: [list with citations]' — do not elaborate on the case itself\n"
                "- The syllabus IS the source. Its reading list entries ARE the findable facts. Cite them as [N].\n\n"
                "Guidelines:\n"
                "- ONLY use citation numbers that match the [Source N] headers listed above\n"
                "- Do NOT use numbered references found inside the source documents (e.g. bibliographies, footnotes like [31] or [54]) — those are internal to the documents, not valid citation numbers\n"
                "- Add [N] citations inline where information comes from source N\n"
                "- Multiple sources can be cited together like [1][2]\n"
                "- Be precise - cite at the claim level, not just at the end of paragraphs\n"
                "- Natural placement - citations should feel unobtrusive\n"
                "- Cite from ALL sources that contain relevant information — do not omit retrieved sources that support the answer\n"
                "- When adding context, explanation, or reasoning not directly supported by the retrieved sources, label it with [AI:N,M] or [AI] (see below)\n\n"
                "INFERENCE POLICY — Three markers:\n"
                "Tier 1 — Grounded facts (inference prohibited): All statements that convey information must come directly from retrieved sources. "
                "If no source explicitly covers the queried entity or topic, state that gap clearly — do not construct an answer to fulfill the request.\n"
                "Tier 2 — Source-grounded inference (permitted, must be attributed): If sources contain a concept, definition, principle, or fact relevant to the query, "
                "you MAY extend, apply, or connect it — clearly marked as inference. Mark all such statements with [AI:N,M] where N,M are the source numbers the inference extends from.\n"
                "Tier 3 — General knowledge (permitted, must be labeled): Statements that come entirely from training knowledge with no connection to any retrieved source. Mark with [AI].\n"
                "- Never present inference or general knowledge as established fact\n"
                "- Never use inference to answer a direct factual query the sources don't support\n"
                "- Do NOT reuse specific facts, names, or claims from your earlier responses — base all claims on current sources above\n\n"
                "CITATION INTEGRITY — THE VERBATIM TEST:\n"
                "Before tagging any statement as [N], ask: 'Can I find this specific claim in the source text above?' "
                "If the source only mentions the topic but does not contain this specific claim, use [AI:N] or [AI] instead.\n"
                "- A source that lists a case study as a reading does NOT contain that case study's facts\n"
                "- A source that mentions a building, policy, or concept does NOT contain all facts about that building, policy, or concept\n"
                "- Specific numbers (percentages, dollar amounts, dates, counts) are almost never present in a course syllabus or summary source — tag them [AI] unless you can read them verbatim in the source text provided\n\n"
                "REQUIRED — Inference & Knowledge Attribution:\n"
                "Every sentence — including analogies, explanations, reasoning, and general knowledge statements — MUST carry exactly one marker:\n"
                "  [N] — this came directly from source N. The user can click and find it.\n"
                "  [AI:N,M] — the source gave me the concept; I extended, applied, or connected it. List all source numbers the inference builds from.\n"
                "  [AI:N] — same as above but building from a single source.\n"
                "  [AI] — this comes entirely from training knowledge. No source is involved.\n"
                "- [N] and [AI] are mutually exclusive — NEVER write both on the same statement.\n"
                "- If a statement is grounded in source N but also extends it with general knowledge, use [AI:N] alone — not [N] followed by [AI].\n"
                "- Do NOT apply [AI:N,M] or [AI] to statements already cited with [N].\n"
                "- CRITICAL PLACEMENT RULE: [AI:N,M] and [AI] MUST appear at the END of the sentence they label, immediately before the period. NEVER place them immediately after a [N] numeric citation.\n"
                "- Apply at the sentence level, inline — not only at paragraph ends.\n"
                "Examples:\n"
                "  'Carbon credits function like tradeable permits for emissions. [AI]'\n"
                "  'The retrofit achieved 38% energy savings and a 3-year payback. [AI]' ← correct if source does not contain these numbers\n"
                "  'This regulatory structure suggests companies prioritize cheaper offsets first. [AI:2,3]'\n"
                "  'Trade-offs include cost and quality [AI:1].' ← grounded in source 1 but extended with general reasoning\n\n"
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
