from typing import AsyncGenerator, Any
import asyncio
import json
import logging
import traceback

logger = logging.getLogger(__name__)


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
        # Send error event
        error_data = json.dumps({
            "type": "error",
            "error": f"{type(e).__name__}: {str(e)}",
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
