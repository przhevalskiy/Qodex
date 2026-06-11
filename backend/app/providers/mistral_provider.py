"""Mistral provider — fallback when Claude is overloaded. Uses tool use via complete_async."""
import json
import logging
from typing import AsyncGenerator, Dict, List, Optional

from mistralai import Mistral

from app.models.message import Message, MessageRole

logger = logging.getLogger(__name__)

_instance: Optional["MistralProvider"] = None


def get_mistral_provider(api_key: str, model: str = "mistral-large-latest") -> "MistralProvider":
    global _instance
    if _instance is None:
        _instance = MistralProvider(api_key=api_key, model=model)
    return _instance


def _convert_tools(anthropic_tools: List[Dict]) -> List[Dict]:
    """Convert Anthropic tool schema format to Mistral function format."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {}),
            },
        }
        for t in anthropic_tools
    ]


class MistralProvider:
    def __init__(self, api_key: str, model: str = "mistral-large-latest"):
        self.client = Mistral(api_key=api_key)
        self.model = model

    def _format_messages(self, messages: List[Message], system_prompt: str) -> List[Dict]:
        formatted = []
        if system_prompt:
            formatted.append({"role": "system", "content": system_prompt})

        for msg in messages:
            if not msg.content or not msg.content.strip():
                continue
            if msg.role == MessageRole.SYSTEM:
                continue

            # Reconstruct show_checklist tool call/result from __checklist__ sentinel
            if msg.role == MessageRole.ASSISTANT and msg.content.startswith("__checklist__"):
                lines = msg.content.split("\n")[1:]
                fields: Dict[str, str] = {}
                for line in lines:
                    if line.startswith("**") and "**: " in line:
                        key = line[2:line.index("**", 2)]
                        value = line[line.index("**: ") + 4:]
                        fields[key] = value

                tool_call_id = "toolu_checklist_synthetic"
                formatted.append({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": "show_checklist",
                            "arguments": json.dumps({"fields": fields, "intent": msg.intent or "other"}),
                        },
                    }],
                })
                formatted.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": "Checklist displayed to user. Awaiting confirmation.",
                })
                continue

            formatted.append({"role": msg.role.value, "content": msg.content})

        return formatted

    async def stream_completion(
        self,
        messages: List[Message],
        system_prompt: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[List[Dict]] = None,
        stream_metadata: Optional[Dict] = None,
    ) -> AsyncGenerator[str, None]:
        """Non-streaming complete_async, yielded as a single chunk to match the ClaudeProvider interface."""
        formatted = self._format_messages(messages, system_prompt)

        kwargs: Dict = {
            "model": self.model,
            "messages": formatted,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = _convert_tools(tools)
            kwargs["tool_choice"] = "auto"

        response = await self.client.chat.complete_async(**kwargs)
        choice = response.choices[0] if response.choices else None
        if not choice:
            return

        msg = choice.message

        # Yield text content
        if msg.content:
            yield msg.content

        # Capture tool calls into stream_metadata
        if stream_metadata is not None and msg.tool_calls:
            tool_calls = []
            for tc in msg.tool_calls:
                try:
                    input_data = json.loads(tc.function.arguments) if tc.function.arguments else {}
                except Exception:
                    input_data = {}
                tool_calls.append({
                    "id": tc.id or "mistral_tool",
                    "name": tc.function.name,
                    "input": input_data,
                })
            stream_metadata["tool_calls"] = tool_calls
