"""Prompt sanitizer for PII removal and injection detection."""

import re
from typing import List, Dict, Any


class PromptSanitizer:
    """Sanitizes prompts by removing PII and detecting injection attempts."""

    CREDIT_CARD_PATTERN = re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b')
    SSN_PATTERN = re.compile(r'\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b')
    EMAIL_PATTERN = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
    PHONE_PATTERN = re.compile(r'\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b')

    INJECTION_PATTERNS = [
        re.compile(r'ignore\s+(?:all\s+|the\s+)?(previous|above|prior)\s+(instructions|directions|prompts?)', re.IGNORECASE),
        re.compile(r'(enter|enable|activate)\s+developer\s+mode', re.IGNORECASE),
        re.compile(r'you\s+are\s+now\s+in\s+developer\s+mode', re.IGNORECASE),
        re.compile(r'disregard\s+(?:all\s+|the\s+)?(previous|above|prior)', re.IGNORECASE),
        re.compile(r'bypass\s+(restrictions|rules|guidelines)', re.IGNORECASE),
    ]

    def sanitize(self, text: str) -> str:
        if not text:
            return text
        for pattern in self.INJECTION_PATTERNS:
            if pattern.search(text):
                return "[POTENTIAL INJECTION DETECTED - REMOVED]"
        text = self.CREDIT_CARD_PATTERN.sub('<CREDIT_CARD>', text)
        text = self.SSN_PATTERN.sub('<SSN>', text)
        text = self.EMAIL_PATTERN.sub('<EMAIL>', text)
        text = self.PHONE_PATTERN.sub('<PHONE>', text)
        return text

    def sanitize_history(self, history: List[Dict[str, Any]], max_items: int = 3) -> List[Dict[str, Any]]:
        if not history:
            return []
        limited = history[-max_items:] if len(history) > max_items else history
        sanitized = []
        for item in limited:
            s = item.copy()
            if 'content' in s:
                s['content'] = self.sanitize(s['content'])
            sanitized.append(s)
        return sanitized
