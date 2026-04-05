"""Interactive installer for cz-cli AI skills."""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
from pathlib import Path

try:
    import questionary
    from questionary import Style
except ImportError:
    print("Error: questionary is required for the interactive installer.")
    print("Install it with: pip install questionary")
    sys.exit(1)


# Tool configuration: maps tool names to their skills directory paths
TOOL_CONFIGS = {
    "Claude Code": "~/.claude/skills",
    "OpenClaw": "~/.openclaw/workspace/skills",
    "Cursor": ".cursor/skills",
    "Codex": ".codex/skills",
    "OpenCode": ".opencode/skills",
    "GitHub Copilot": ".github/skills",
    "Qoder": ".qoder/skills",
    "Trae": ".trae/skills",
}

# Custom style to remove background highlighting
custom_style = Style(
    [
        ("qmark", "fg:#5f819d bold"),
        ("question", "bold"),
        ("answer", "fg:#5f819d bold"),
        ("pointer", "fg:#5f819d bold"),
        ("highlighted", "fg:#5f819d bold"),
        ("selected", "fg:#5f819d"),
        ("separator", "fg:#6c6c6c"),
        ("instruction", ""),
        ("text", ""),
    ]
)


def get_package_skills_dir() -> Path:
    """Get the skills directory from the installed package or development mode."""
    current_file = Path(__file__).resolve()
    skills_dir = current_file.parent.parent / "skills"
    if skills_dir.exists():
        return skills_dir

    raise FileNotFoundError(
        "Could not find skills directory. Please ensure cz-cli is properly installed."
    )


def get_mcp_skills_dir() -> Path | None:
    """Find `cz_mcp/skills` from site-packages or local development checkout."""
    candidates: list[Path] = []

    spec = importlib.util.find_spec("cz_mcp")
    if spec and spec.submodule_search_locations:
        for location in spec.submodule_search_locations:
            candidates.append(Path(location) / "skills")

    env_path = os.environ.get("CZ_MCP_SERVER_PATH", "").strip()
    if env_path:
        raw = Path(env_path).expanduser()
        candidates.extend([raw / "cz_mcp" / "skills", raw / "skills"])

    repo_root = Path(__file__).resolve().parents[2]
    candidates.append(
        repo_root.parent / "claude-skills-mcp" / "cz-mcp-server" / "cz_mcp" / "skills"
    )

    seen: set[str] = set()
    for path in candidates:
        key = str(path.resolve()) if path.exists() else str(path)
        if key in seen:
            continue
        seen.add(key)
        if path.exists() and path.is_dir():
            return path
    return None


def _iter_skill_names(skills_dir: Path) -> list[str]:
    return sorted(
        item.name
        for item in skills_dir.iterdir()
        if item.is_dir() and item.name not in {"__pycache__"} and not item.name.startswith("__")
    )


def discover_available_skills() -> tuple[dict[str, Path], dict[str, Path], list[str]]:
    """
    Discover installable skills.

    Returns:
    - skill_sources: skill_name -> source directory path
    - source_dirs: source_label -> base skills directory
    - duplicate_skills: duplicate names ignored from lower-priority sources
    """
    source_dirs: dict[str, Path] = {"cz-cli": get_package_skills_dir()}
    mcp_skills_dir = get_mcp_skills_dir()
    if mcp_skills_dir:
        source_dirs["cz-mcp"] = mcp_skills_dir

    skill_sources: dict[str, Path] = {}
    duplicate_skills: list[str] = []

    # Priority order follows source_dirs insertion order.
    for _, base_dir in source_dirs.items():
        for skill_name in _iter_skill_names(base_dir):
            source_skill_dir = base_dir / skill_name
            if skill_name in skill_sources:
                duplicate_skills.append(skill_name)
                continue
            skill_sources[skill_name] = source_skill_dir

    return skill_sources, source_dirs, sorted(set(duplicate_skills))


def get_tool_skills_path(tool_name: str, project_root: Path) -> Path:
    """Get the full path to the skills directory for a given tool."""
    skills_dir_name = TOOL_CONFIGS.get(tool_name)
    if not skills_dir_name:
        raise ValueError(f"Unknown tool: {tool_name}")

    path = Path(skills_dir_name)

    # If path starts with ~, expand it (global path)
    if skills_dir_name.startswith("~"):
        return path.expanduser()

    # Otherwise, it's relative to project root
    return project_root / skills_dir_name


def is_global_tool_path(tool_name: str) -> bool:
    """Check if the tool uses a global path (starts with ~)."""
    skills_dir_name = TOOL_CONFIGS.get(tool_name, "")
    return skills_dir_name.startswith("~")


def copy_skill(source_skill_dir: Path, target_skills_dir: Path, skill_name: str) -> bool:
    """Copy a skill directory to the target location."""
    target_skill_dir = target_skills_dir / skill_name

    try:
        # Remove existing skill if present
        if target_skill_dir.exists():
            shutil.rmtree(target_skill_dir)

        # Create parent directory if needed
        target_skills_dir.mkdir(parents=True, exist_ok=True)

        # Copy the skill directory
        shutil.copytree(source_skill_dir, target_skill_dir)
        return True
    except Exception as e:
        print(f"❌ Error copying skill {skill_name}: {e}")
        return False


def install_skills(
    skill_sources: dict[str, Path],
    selected_tools: list[str],
    selected_skills: list[str],
    project_root: Path,
) -> None:
    """Install selected skills to selected tools."""
    print("\n📦 Installing skills...\n")

    for tool_name in selected_tools:
        tool_skills_path = get_tool_skills_path(tool_name, project_root)
        print(f"Installing to {tool_name}: {tool_skills_path}")
        print("  ℹ️  Existing skills with the same name will be replaced.")

        for skill_name in selected_skills:
            source_skill_dir = skill_sources.get(skill_name)

            if source_skill_dir is None or not source_skill_dir.exists():
                print(f"Notice:  Skill '{skill_name}' not found, skipping...")
                continue

            success = copy_skill(source_skill_dir, tool_skills_path, skill_name)
            if success:
                print(f"  ✅ {skill_name}")
            else:
                print(f"  ❌ {skill_name}")

        print()

    print("✨ Installation complete!")


def choose_skills(skill_choices: list[str]) -> list[str]:
    """Interactive skill selection with support for install-all."""
    install_all = questionary.confirm(
        "Install all available skills? Type 'n' to select specific skills.",
        default=True,
        style=custom_style,
    ).ask()
    if install_all:
        return list(skill_choices)

    selected_skills = questionary.checkbox(
        "Select skills to install (use Space to select, Enter to confirm):",
        choices=skill_choices,
        style=custom_style,
    ).ask()
    return selected_skills or []


def main() -> None:
    """Main entry point for the interactive installer."""
    print("🎒 cz-cli AI Skills Installer\n")

    try:
        skill_sources, source_dirs, duplicate_skills = discover_available_skills()
        if not skill_sources:
            print("❌ No skills found in cz-cli or cz-mcp package directories.")
            sys.exit(1)

        print("📁 Skills sources:")
        for label, base_dir in source_dirs.items():
            print(f"  - {label}: {base_dir}")
        print()
        if duplicate_skills:
            print(
                f"Notice:  Duplicate skills ignored from lower-priority source: {', '.join(duplicate_skills)}\n"
            )

        # Step 1: Select tool
        tool_name = questionary.select(
            "Which AI coding tool are you using?",
            choices=list(TOOL_CONFIGS.keys()),
            style=custom_style,
        ).ask()

        if not tool_name:
            print("\n❌ Installation cancelled.")
            return

        # Step 2: Confirm installation path
        project_root = Path.cwd()
        tool_skills_path = get_tool_skills_path(tool_name, project_root)

        if is_global_tool_path(tool_name):
            confirm_msg = f"Skills will be installed to: {tool_skills_path}\n\nThis is a global installation. Continue?"
        else:
            confirm_msg = f"Skills will be installed to: {tool_skills_path}\n\nThis is relative to current directory: {project_root}\nContinue?"

        confirm = questionary.confirm(
            confirm_msg,
            default=True,
            style=custom_style,
        ).ask()

        if not confirm:
            print("\n❌ Installation cancelled.")
            return

        # Step 3: Select skills
        skill_choices = sorted(skill_sources.keys(), key=lambda name: (name != "cz-cli", name))
        selected_skills = choose_skills(skill_choices)

        if not selected_skills:
            print("\n❌ No skills selected. Installation cancelled.")
            return

        # Step 4: Installation summary
        print("\n📋 Installation Summary:")
        print(f"   Tool: {tool_name}")
        print(f"   Path: {tool_skills_path}")
        print(f"   Skills: {', '.join(selected_skills)}")

        final_confirm = questionary.confirm(
            "\nProceed with installation?",
            default=True,
            style=custom_style,
        ).ask()

        if not final_confirm:
            print("\n❌ Installation cancelled.")
            return

        # Step 5: Install
        install_skills(skill_sources, [tool_name], selected_skills, project_root)

    except KeyboardInterrupt:
        print("\n\n❌ Installation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
