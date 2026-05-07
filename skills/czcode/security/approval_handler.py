"""Approval handler for tool prediction and user approval flow."""
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

# Tool prediction mappings
TOOL_PATTERNS = {
    "Read":       ["read", "show", "display", "view", "check", "inspect", "open", "cat"],
    "Write":      ["create", "write", "generate", "save", "output", "new file"],
    "Edit":       ["edit", "modify", "update", "change", "fix", "refactor", "replace"],
    "Bash":       ["run", "execute", "command", "script", "install", "shell", "test"],
    "Grep":       ["search", "find", "pattern", "match", "contains", "grep"],
    "Glob":       ["find files", "list files", "directory", "locate", "glob"],
    "WebFetch":   ["fetch", "url", "http", "download", "web page"],
    "WebSearch":  ["search web", "google", "look up", "research"],
}

BASE_TOOLS = ["Read", "Bash"]


@dataclass
class ApprovalResult:
    approved: bool
    allowed_tools: List[str]
    user_response: str


class ApprovalHandler:
    def __init__(self, confidence_threshold: float = 0.7):
        self.confidence_threshold = confidence_threshold

    def predict_tools(self, prompt: str, envelope: Dict[str, Any]) -> Dict[str, Any]:
        prompt_lower = prompt.lower()
        predicted = set(BASE_TOOLS)
        matched = []

        for tool, patterns in TOOL_PATTERNS.items():
            hits = [p for p in patterns if p in prompt_lower]
            if hits:
                predicted.add(tool)
                matched.append(f"{tool}: {', '.join(hits)}")

        total_words = len(prompt_lower.split())
        if total_words == 0:
            confidence = 0.5
        elif not matched:
            confidence = 0.5
        else:
            confidence = min(0.9, 0.5 + (len(matched) / max(total_words / 5, 1)) * 0.4)

        if total_words < 5:
            confidence *= 0.8
        elif total_words > 20:
            confidence *= 0.95

        reasoning = (
            f"Matched {len(matched)} patterns: {'; '.join(matched[:3])}"
            + (f" and {len(matched) - 3} more" if len(matched) > 3 else "")
            if matched else "Using base tools only"
        )

        return {
            "tools": sorted(predicted),
            "confidence": round(confidence, 2),
            "reasoning": reasoning,
        }

    def format_approval_prompt(
        self,
        tools: List[str],
        confidence: float,
        envelope: Dict[str, Any],
        reasoning: str,
    ) -> str:
        user_prompt = envelope.get("user_prompt", "Unknown request")
        lines = [
            "=" * 70,
            "CZCODE TOOL APPROVAL REQUEST",
            "=" * 70,
            "",
            f"User Request: {user_prompt}",
            "",
            f"Predicted Tools ({len(tools)}):",
        ]
        for tool in tools:
            lines.append(f"  - {tool}")
        lines += [
            "",
            f"Prediction Confidence: {confidence:.0%}",
            f"Reasoning: {reasoning}",
            "",
        ]
        if confidence < self.confidence_threshold:
            lines += [
                f"WARNING: Low confidence ({confidence:.0%} < {self.confidence_threshold:.0%})",
                "   Tool predictions may be incomplete.",
                "",
            ]
        lines += [
            "=" * 70,
            "APPROVAL OPTIONS:",
            "  approve      - Allow these specific tools",
            "  approve_all  - Allow all tools",
            "  deny         - Reject this request",
            "=" * 70,
            "",
            "Your response: ",
        ]
        return "\n".join(lines)

    def parse_user_response(self, response: str) -> ApprovalResult:
        r = response.strip().lower()
        if r == "approve":
            return ApprovalResult(approved=True, allowed_tools=[], user_response="approve")
        elif r == "approve_all":
            return ApprovalResult(approved=True, allowed_tools=["*"], user_response="approve_all")
        else:
            return ApprovalResult(approved=False, allowed_tools=[], user_response=response)
