"""Interactive installer for cz-cli AI skills."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from typing import Any

try:
    import questionary
    from questionary import Style
except ImportError:
    print("Error: questionary is required for the interactive installer.")
    print("Install it with: pip install questionary")
    sys.exit(1)


# Tool configuration: maps tool names to their skills directory paths
TOOL_CONFIGS = {
    "Claude Code": ".claude/skills",
    "OpenClaw": "~/.openclaw/workspace/skills",
    "Cursor": ".cursor/skills",
    "Codex": ".codex/skills",
    "OpenCode": ".opencode/skills",
    "GitHub Copilot": ".github/skills",
    "Qoder": ".qoder/skills",
    "Trae": ".trae/skills",
}

# Available skills bundled with cz-cli
AVAILABLE_SKILLS = [
    "cz-cli",
]

# Custom style to remove background highlighting
custom_style = Style([
    ("qmark", "fg:#5f819d bold"),
    ("question", "bold"),
    ("answer", "fg:#5f819d bold"),
    ("pointer", "fg:#5f819d bold"),
    ("highlighted", "fg:#5f819d bold"),
    ("selected", "fg:#5f819d"),
    ("separator", "fg:#6c6c6c"),
    ("instruction", ""),
    ("text", ""),
])


def get_package_skills_dir() -> Path:
    """Get the skills directory from the installed package or development mode."""
    # Try to find the skills directory relative to this file
    current_file = Path(__file__).resolve()

    # In development mode: cz_cli/commands/skills_installer.py -> cz_cli/skills/
    dev_skills_dir = current_file.parent.parent / "skills"
    if dev_skills_dir.exists():
        return dev_skills_dir

    # In installed mode: site-packages/cz_cli/commands/skills_installer.py -> site-packages/cz_cli/skills/
    installed_skills_dir = current_file.parent.parent / "skills"
    if installed_skills_dir.exists():
        return installed_skills_dir

    raise FileNotFoundError(
        "Could not find skills directory. "
        "Please ensure cz-cli is properly installed."
    )


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
    package_skills_dir: Path,
    selected_tools: list[str],
    selected_skills: list[str],
    project_root: Path,
) -> None:
    """Install selected skills to selected tools."""
    print("\n📦 Installing skills...\n")

    for tool_name in selected_tools:
        tool_skills_path = get_tool_skills_path(tool_name, project_root)
        print(f"Installing to {tool_name}: {tool_skills_path}")

        for skill_name in selected_skills:
            source_skill_dir = package_skills_dir / skill_name

            if not source_skill_dir.exists():
                print(f"⚠️  Skill '{skill_name}' not found, skipping...")
                continue

            success = copy_skill(source_skill_dir, tool_skills_path, skill_name)
            if success:
                print(f"  ✅ {skill_name}")
            else:
                print(f"  ❌ {skill_name}")

        print()

    print("✨ Installation complete!")


def main() -> None:
    """Main entry point for the interactive installer."""
    print("🎒 cz-cli AI Skills Installer\n")

    try:
        # Get package skills directory
        package_skills_dir = get_package_skills_dir()
        print(f"📁 Skills directory: {package_skills_dir}\n")

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
        selected_skills = questionary.checkbox(
            "Select skills to install (use Space to select, Enter to confirm):",
            choices=AVAILABLE_SKILLS,
            style=custom_style,
        ).ask()

        if not selected_skills:
            print("\n❌ No skills selected. Installation cancelled.")
            return

        # Step 4: Installation summary
        print(f"\n📋 Installation Summary:")
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
        install_skills(package_skills_dir, [tool_name], selected_skills, project_root)

    except KeyboardInterrupt:
        print("\n\n❌ Installation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
