# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT_DIR = Path(SPECPATH).resolve().parent
ENTRYPOINT = ROOT_DIR / "cz_cli" / "__main__.py"

if not ENTRYPOINT.exists():
    raise FileNotFoundError(f"Entrypoint not found: {ENTRYPOINT}")

# Include bundled skills so `cz-cli install-skills` keeps working in standalone binaries.
datas = collect_data_files("cz_cli", includes=["skills/**/*"])

try:
    datas += collect_data_files("cz_mcp", includes=["skills/**/*"])
except Exception:
    # Optional fallback: allow building even if cz_mcp package is unavailable in build env.
    pass

# Restrict to v0 modules used by this CLI to avoid optional extras.
hiddenimports = collect_submodules("clickzetta.connector.v0")


a = Analysis(
    [str(ENTRYPOINT)],
    pathex=[str(ROOT_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="cz-cli",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
