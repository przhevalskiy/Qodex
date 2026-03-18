from typing import AsyncGenerator, Any
import asyncio
import json
import logging
import traceback

logger = logging.getLogger(__name__)

PROVIDER_NAMES = {
    "claude": "Claude",
    "mistral": "Mistral",
}


def _friendly_error(exc: Exception, provider: str) -> str:
    """Map a provider exception to a short, user-facing message."""
    raw = str(exc).lower()
    name = PROVIDER_NAMES.get(provider, provider.capitalize())

    # Rate limit (HTTP 429)
    if "429" in raw or "rate limit" in raw or "rate_limit" in raw or "1300" in raw:
        return (
            f"{name} is currently rate-limited. Please wait a moment and try again, "
            "or switch to a different provider."
        )
    # Overloaded / service unavailable (HTTP 529 / 503)
    if "529" in raw or "503" in raw or "overloaded" in raw or "unavailable" in raw:
        return (
            f"{name} is experiencing high traffic right now. "
            "Please try again in a few seconds."
        )
    # Auth / API key issues (HTTP 401 / 403)
    if "401" in raw or "403" in raw or "unauthorized" in raw or "invalid api key" in raw or "api key" in raw:
        return (
            f"There's an authentication issue with {name}. "
            "Please check your API key in Settings."
        )
    # Network / connection errors
    if "timeout" in raw or "connection" in raw or "network" in raw:
        return (
            f"Could not reach {name}. Please check your connection and try again."
        )
    # Context / token limit exceeded
    if "context" in raw and ("length" in raw or "limit" in raw):
        return (
            "The conversation is too long for this provider. "
            "Try starting a new discussion or shortening your message."
        )
    # Generic fallback
    return (
        f"{name} returned an unexpected error. Please try again, "
        "or switch to a different provider."
    )


async def create_sse_response(
    generator: AsyncGenerator[str, None],
    provider: str,
    send_done: bool = True
) -> AsyncGenerator[str, None]:
    """
    Create SSE formatted response from a generator.

    Args:
        generator: Async generator yielding text chunks
        provider: Name of the AI provider
        send_done: Whether to send the done event (default: True)

    Yields:
        SSE formatted strings
    """
    try:
        async for chunk in generator:
            # Format as SSE event
            data = json.dumps({
                "type": "chunk",
                "content": chunk,
                "provider": provider
            })
            yield f"data: {data}\n\n"
            await asyncio.sleep(0)  # cede to event loop → force socket flush per chunk
    except Exception as e:
        # Log the full error with traceback
        logger.error(f"Streaming error from {provider}: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        # Send a user-friendly error message instead of the raw exception
        error_data = json.dumps({
            "type": "error",
            "error": _friendly_error(e, provider),
            "provider": provider
        })
        yield f"data: {error_data}\n\n"
    finally:
        # Send done event only if requested
        if send_done:
            done_data = json.dumps({
                "type": "done",
                "provider": provider
            })
            yield f"data: {done_data}\n\n"


def format_sse_event(event_type: str, data: Any) -> str:
    """Format a single SSE event."""
    payload = json.dumps({"type": event_type, **data})
    return f"data: {payload}\n\n"
