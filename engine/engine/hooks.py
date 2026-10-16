"""Claude rewords his hook lines a little, so the words over the hook are not
the same on every video - his meaning and his words' feel, never new claims.

Asked once per batch for a few rewordings of each line; the render then draws
from his lines and the rewordings without repeating (remixer's bags). Without
an ANTHROPIC_API_KEY, or if Claude can't be reached, his own lines are used.
"""

import json

from . import config

MODEL = "claude-opus-5-5"

SYSTEM = (
    "You reword short on-screen hooks for short-form videos. For each hook, write the requested number of "
    "close rewordings: same meaning, same tone and length, same language, nothing added - no new claims, "
    "numbers, names, emoji or hashtags that are not in the original. Keep each under 12 words."
)


def rewordings(lines: list[str], per_line: int = 3, client=None) -> list[str]:
    """His lines plus Claude's rewordings of them; just his lines when Claude isn't available."""
    lines = [line for line in lines if line.strip()]
    if not lines or per_line <= 0:
        return lines
    if client is None:
        if not config.ANTHROPIC_API_KEY:
            return lines
        import anthropic

        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            output_config={
                "effort": "low",
                "format": {
                    "type": "json_schema",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "hooks": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "original": {"type": "string"},
                                        "rewordings": {"type": "array", "items": {"type": "string"}},
                                    },
                                    "required": ["original", "rewordings"],
                                    "additionalProperties": False,
                                },
                            }
                        },
                        "required": ["hooks"],
                        "additionalProperties": False,
                    },
                },
            },
            messages=[{
                "role": "user",
                "content": f"Write {per_line} rewordings of each of these hooks:\n"
                + "\n".join(f"- {line}" for line in lines),
            }],
        )
    except Exception as error:  # noqa: BLE001 - his own lines are always a fine answer
        print(f"hooks: Claude could not reword them, using his own: {error}")
        return lines
    if getattr(response, "stop_reason", None) == "refusal":
        return lines
    text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
    try:
        data = json.loads(text)
    except ValueError:
        return lines
    out = list(lines)
    for item in data.get("hooks", []):
        for reworded in item.get("rewordings", [])[:per_line]:
            if isinstance(reworded, str) and reworded.strip() and len(reworded) <= 200:
                out.append(reworded.strip())
    return list(dict.fromkeys(out))
