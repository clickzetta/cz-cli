"""Configuration manager with 3-layer precedence: org policy > user config > defaults."""
import copy
import os
import sys
from pathlib import Path
from typing import Any, Optional, Dict

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

_SKILL_DIR = Path(__file__).parent.parent


class ConfigValidationError(Exception):
    pass


class ConfigManager:
    """Manages security configuration with precedence: org policy > user config > defaults."""

    DEFAULT_CONFIG = {
        "security": {
            "approval_mode": "prompt",
            "tool_prediction_confidence_threshold": 0.7,
            "allow_tool_expansion": True,
            "audit_log_path": str(_SKILL_DIR / "audit.log"),
            "audit_log_rotation": "10MB",
            "audit_log_retention": 30,
            "sanitize_conversation_history": True,
            "max_history_items": 3,
            "cache_dir": "~/.cache/czcode-skill",
            "cache_permissions": "0600",
            "allowed_envelopes": ["RO", "RW", "RESEARCH"],
            "deploy_envelope_confirmation": True,
            "credential_file_allowlist": [
                "~/.ssh/*",
                "~/.clickzetta/*",
                "**/.env",
                "**/.env.*",
                "**/credentials.json",
                "**/*_key.p8",
                "**/*_key.pem",
                "~/.aws/credentials",
                "~/.kube/config",
                "**/.netrc",
                "**/*.pem",
                "**/*.key",
            ],
        }
    }

    def __init__(
        self,
        config_path: Optional[Path] = None,
        org_policy_path: Optional[Path] = None,
    ):
        self._config = self._load_config(config_path, org_policy_path)

    def _validate_config(self, config: Dict) -> None:
        security = config.get("security", {})
        approval_mode = security.get("approval_mode")
        if approval_mode not in ["prompt", "auto", "envelope_only"]:
            raise ConfigValidationError(
                f"Invalid approval_mode: {approval_mode}. Must be: prompt, auto, envelope_only"
            )
        valid_envelopes = {"RO", "RW", "RESEARCH", "DEPLOY", "NONE"}
        for envelope in security.get("allowed_envelopes", []):
            if envelope not in valid_envelopes:
                raise ConfigValidationError(f"Invalid envelope: {envelope}")
        confidence = security.get("tool_prediction_confidence_threshold")
        if confidence is not None and not (0 <= float(confidence) <= 1):
            raise ConfigValidationError(
                f"tool_prediction_confidence_threshold must be 0-1, got {confidence}"
            )

    def _expand_paths(self, config: Dict) -> Dict:
        security = config.get("security", {})
        for key in ("audit_log_path", "cache_dir"):
            if key in security:
                security[key] = os.path.expanduser(security[key])
        config["security"] = security
        return config

    def _load_config(self, config_path: Optional[Path], org_policy_path: Optional[Path]) -> Dict:
        config = copy.deepcopy(self.DEFAULT_CONFIG)

        if yaml is None:
            # No yaml available -- use defaults only
            self._validate_config(config)
            return self._expand_paths(config)

        for path, label in [(config_path, "user config"), (org_policy_path, "org policy")]:
            if path and path.exists():
                try:
                    with open(path, 'r') as f:
                        override = yaml.safe_load(f) or {}
                    if label == "org policy" and override.get("security", {}).get("override_user_config"):
                        config = self._merge_config(copy.deepcopy(self.DEFAULT_CONFIG), override)
                    else:
                        config = self._merge_config(config, override)
                except Exception as e:
                    print(f"Warning: Failed to load {label} {path}: {e}", file=sys.stderr)

        self._validate_config(config)
        return self._expand_paths(config)

    def _merge_config(self, base: Dict, override: Dict) -> Dict:
        result = copy.deepcopy(base)
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge_config(result[key], value)
            else:
                result[key] = value
        return result

    def get(self, key: str, default: Any = None) -> Any:
        keys = key.split(".")
        value = self._config
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        return value
