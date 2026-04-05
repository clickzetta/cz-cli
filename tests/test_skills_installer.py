"""Tests for skills installer source discovery and installation."""

from pathlib import Path

from cz_cli.commands import skills_installer


def _mkdir_skill(base: Path, name: str) -> Path:
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(f"# {name}\n", encoding="utf-8")
    return skill_dir


def test_discover_available_skills_merges_sources(monkeypatch, tmp_path: Path):
    cz_cli_skills = tmp_path / "cz_cli_skills"
    cz_mcp_skills = tmp_path / "cz_mcp_skills"
    cz_cli_skills.mkdir()
    cz_mcp_skills.mkdir()

    _mkdir_skill(cz_cli_skills, "cz-cli")
    shared_from_cli = _mkdir_skill(cz_cli_skills, "shared-skill")
    _mkdir_skill(cz_mcp_skills, "mcp-only")
    _mkdir_skill(cz_mcp_skills, "shared-skill")

    monkeypatch.setattr(skills_installer, "get_package_skills_dir", lambda: cz_cli_skills)
    monkeypatch.setattr(skills_installer, "get_mcp_skills_dir", lambda: cz_mcp_skills)

    skill_sources, source_dirs, duplicate_skills = skills_installer.discover_available_skills()

    assert set(source_dirs.keys()) == {"cz-cli", "cz-mcp"}
    assert set(skill_sources.keys()) == {"cz-cli", "shared-skill", "mcp-only"}
    assert skill_sources["shared-skill"] == shared_from_cli
    assert duplicate_skills == ["shared-skill"]


def test_install_skills_copies_selected_to_tool_path(tmp_path: Path):
    source_root = tmp_path / "sources"
    source_root.mkdir()
    source_skill = _mkdir_skill(source_root, "mcp-only")

    skill_sources = {"mcp-only": source_skill}
    project_root = tmp_path / "project"
    project_root.mkdir()

    skills_installer.install_skills(
        skill_sources=skill_sources,
        selected_tools=["Codex"],
        selected_skills=["mcp-only"],
        project_root=project_root,
    )

    installed = project_root / ".codex" / "skills" / "mcp-only" / "SKILL.md"
    assert installed.exists()


def test_install_skills_overwrites_existing_skill(tmp_path: Path):
    source_root = tmp_path / "sources"
    source_root.mkdir()
    source_skill = _mkdir_skill(source_root, "mcp-only")
    (source_skill / "SKILL.md").write_text("# new\n", encoding="utf-8")

    project_root = tmp_path / "project"
    existing = project_root / ".codex" / "skills" / "mcp-only"
    existing.mkdir(parents=True, exist_ok=True)
    (existing / "SKILL.md").write_text("# old\n", encoding="utf-8")

    skills_installer.install_skills(
        skill_sources={"mcp-only": source_skill},
        selected_tools=["Codex"],
        selected_skills=["mcp-only"],
        project_root=project_root,
    )

    installed = project_root / ".codex" / "skills" / "mcp-only" / "SKILL.md"
    assert installed.read_text(encoding="utf-8") == "# new\n"


def test_choose_skills_returns_all_when_confirmed(monkeypatch):
    monkeypatch.setattr(
        skills_installer.questionary,
        "confirm",
        lambda *args, **kwargs: type("Q", (), {"ask": lambda self: True})(),
    )
    monkeypatch.setattr(
        skills_installer.questionary,
        "checkbox",
        lambda *args, **kwargs: type("Q", (), {"ask": lambda self: []})(),
    )

    selected = skills_installer.choose_skills(["a", "b", "c"])
    assert selected == ["a", "b", "c"]


def test_claude_code_uses_global_skills_path(tmp_path: Path):
    tool_path = skills_installer.get_tool_skills_path("Claude Code", tmp_path)
    assert tool_path == Path("~/.claude/skills").expanduser()


def test_claude_code_is_global_tool_path() -> None:
    assert skills_installer.is_global_tool_path("Claude Code") is True
