from typing import AsyncGenerator, List, Optional, Dict
from mistralai import Mistral
import json

from app.models.message import Message
from .base import BaseProvider, ProviderRegistry


class MistralProvider(BaseProvider):
    """Mistral AI API provider implementation."""

    def __init__(self, api_key: str, model: str = "mistral-large-latest"):
        super().__init__(api_key, model)
        self.client = Mistral(api_key=api_key)

    @property
    def provider_name(self) -> str:
        return "mistral"

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
        """Stream completion from Mistral."""
        formatted_messages = []

        # Add system message with context if provided
        if context:
            system_content = (
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
                "- Citations must immediately follow the claim with no space between the claim and the bracket: 'claim [N]' not 'claim  [N]' or 'claim .'\n"
                "- NEVER end a sentence or bullet with a space before the period — if a citation follows, write 'claim [N].' not 'claim .' \n"
                "- CRITICAL: [AI:N,M] and [AI] markers must appear at the END of the inference sentence, before its period. NEVER place them immediately after a [N] numeric citation. CORRECT: 'This implies X [AI:1,2].' WRONG: '...fact [1]. [AI:1,2] This implies X.'\n"
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
                "Before tagging any claim as [N], ask: 'Can I find this specific number, name, date, or statement in the source text above?' "
                "If the answer is NO — even if the source mentions the same topic or entity — the claim comes from your training knowledge and MUST be tagged [AI].\n"
                "- A source that lists a case study as a reading does NOT contain that case study's facts\n"
                "- A source that mentions a building, policy, or concept does NOT contain all facts about that building, policy, or concept\n"
                "- Specific numbers (percentages, dollar amounts, dates, counts) are almost never present in a course syllabus or summary source — tag them [AI] unless you can read them verbatim in the source text provided\n\n"
                "REQUIRED — Inference & Knowledge Attribution:\n"
                "Every sentence that uses explanation, analogy, reasoning, or general knowledge NOT directly quoted from a source MUST be labeled:\n"
                "  [AI:N,M] — causal bridge inference derived from and traceable to sources N and M. List all source numbers you reasoned from.\n"
                "  [AI] — pure general training knowledge with no link to any retrieved source.\n"
                "- Use [AI:N,M] when your inference extends or connects concepts explicitly found in specific retrieved sources.\n"
                "- Use [AI] when the statement comes entirely from general training knowledge.\n"
                "- Do NOT apply [AI:N,M] or [AI] to factual claims already cited with [N].\n"
                "- [N] and [AI] are mutually exclusive — NEVER write both on the same claim. [N] means the source IS connected; [AI] means NO source is connected. These cannot both be true.\n"
                "- If a sentence is grounded in source N but you also extend it with general knowledge, use [AI:N] alone — not [N] followed by [AI].\n"
                "- WRONG: 'Trade-offs include cost and quality [1][AI].'\n"
                "- CORRECT (grounded): 'Trade-offs include cost and quality [1].'\n"
                "- CORRECT (inference from source): 'Trade-offs include cost and quality [AI:1].'\n"
                "- Apply at the sentence level, inline — not only at paragraph ends.\n"
                "Examples:\n"
                "  'Carbon credits function like tradeable permits for emissions. [AI]'\n"
                "  'This regulatory structure suggests companies prioritize cheaper offsets first. [AI:2,3]'\n\n"
                "Now provide an accurate and helpful response with inline citations."
            )

            # Append research depth instructions (controls thoroughness)
            if research_prompt:
                system_content += research_prompt

            # Append intent-specific output structure if present
            if intent_prompt:
                system_content += intent_prompt

            formatted_messages.append({
                "role": "system",
                "content": system_content
            })

        # Add conversation messages (filter out empty messages)
        for msg in messages:
            if msg.content and msg.content.strip():
                formatted_messages.append({
                    "role": msg.role.value,
                    "content": msg.content
                })

        # Inject image attachments as vision content blocks into the last user message
        if image_attachments:
            last = formatted_messages[-1] if formatted_messages else None
            if last and last["role"] == "user":
                content_blocks = [{"type": "text", "text": last["content"]}]
                for img in image_attachments:
                    content_blocks.append({
                        "type": "image_url",
                        "image_url": f"data:{img['media_type']};base64,{img['base64']}",
                    })
                formatted_messages[-1] = {"role": "user", "content": content_blocks}

        async_response = await self.client.chat.stream_async(
            model=self.model,
            messages=formatted_messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        last_finish_reason = None
        async for chunk in async_response:
            if chunk.data.choices and chunk.data.choices[0].delta.content:
                yield chunk.data.choices[0].delta.content
            if chunk.data.choices and chunk.data.choices[0].finish_reason:
                last_finish_reason = chunk.data.choices[0].finish_reason

        # Capture stop reason after stream completes
        if stream_metadata is not None:
            # Mistral uses "length" for token limit, "stop" for natural end
            stream_metadata['stop_reason'] = 'max_tokens' if last_finish_reason == 'length' else 'end_turn'

    async def generate_suggested_questions(
        self,
        conversation_history: List[Dict[str, str]],
        last_response: str,
        count: int = 5
    ) -> List[str]:
        """Generate suggested follow-up questions using Mistral."""
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
                {"role": "system", "content": system_prompt},
                *conversation_history[-6:],
                {"role": "assistant", "content": last_response},
                {"role": "user", "content": "Generate suggested follow-up questions."}
            ]

            response = await self.client.chat.complete_async(
                model="mistral-small-latest",  # Fast model
                messages=messages,
                temperature=0.7,
                max_tokens=200
            )

            content = response.choices[0].message.content.strip()

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
            print(f"Failed to generate suggested questions (Mistral): {e}")
            return []


# Register the provider
ProviderRegistry.register("mistral", MistralProvider)
