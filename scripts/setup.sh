#!/bin/sh
# cz-cli setup — install from extracted archive to ~/.local/bin
# Run from the directory containing this script (same dir as czcli binary).
set -e

INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="czcli"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SKIP_PATH_PROMPT="${SKIP_PATH_PROMPT:-}"
SKIP_SKILLS_INSTALL="${SKIP_SKILLS_INSTALL:-}"

# Docker-friendly
if [ -f /.dockerenv ]; then
    SKIP_PATH_PROMPT=1
fi

print_success() { echo "✓ $1"; }
print_error()   { echo "Error: $1" >&2; }

# Verify we're in the right directory
if [ ! -f "$SCRIPT_DIR/$BINARY_NAME" ]; then
    print_error "Cannot find $BINARY_NAME in $SCRIPT_DIR"
    print_error "Run this script from the extracted zip directory."
    exit 1
fi

# Install binary
echo "Installing $BINARY_NAME to $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
rm -f "$INSTALL_DIR/$BINARY_NAME"
cp "$SCRIPT_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"

# macOS: remove quarantine + ad-hoc sign
if [ "$(uname -s)" = "Darwin" ]; then
    xattr -r -d com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true
    codesign --force --sign - "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || true
fi

print_success "Installed to $INSTALL_DIR/$BINARY_NAME"

# Create cz-cli symlink for backward compatibility
ln -sf "$INSTALL_DIR/$BINARY_NAME" "$INSTALL_DIR/cz-cli" 2>/dev/null || true

# Remove legacy cz-cli (Python version installed by clickzetta/cz-tool)
LEGACY_CZ_DIR="$HOME/.clickzetta/bin"
if [ -d "$LEGACY_CZ_DIR" ]; then
    echo "Removing legacy cz-cli from $LEGACY_CZ_DIR ..."
    rm -rf "$LEGACY_CZ_DIR"
    print_success "Removed legacy cz-cli"
fi
# Also remove standalone 'cz' symlink/binary if present
for legacy_bin in "$INSTALL_DIR/cz" "$HOME/.local/bin/cz"; do
    if [ -f "$legacy_bin" ] && [ "$legacy_bin" != "$INSTALL_DIR/$BINARY_NAME" ]; then
        rm -f "$legacy_bin"
        print_success "Removed legacy $legacy_bin"
    fi
done

# PATH setup
if [ -z "$SKIP_PATH_PROMPT" ]; then
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;  # already in PATH
    *)
        shell_name=$(basename "${SHELL:-sh}")
        config_files=""
        case "$shell_name" in
            zsh)
                config_files="$HOME/.zshrc"
                [ -f "$HOME/.bash_profile" ] && config_files="$config_files $HOME/.bash_profile"
                ;;
            bash)
                config_files="$HOME/.bashrc"
                if [ -f "$HOME/.bash_profile" ]; then
                    config_files="$config_files $HOME/.bash_profile"
                elif [ -f "$HOME/.profile" ]; then
                    config_files="$config_files $HOME/.profile"
                fi
                ;;
            fish) config_files="$HOME/.config/fish/config.fish" ;;
        esac
        _updated_cf=""
        for cf in $config_files; do
            grep -q "$INSTALL_DIR" "$cf" 2>/dev/null && continue
            mkdir -p "$(dirname "$cf")"
            printf '\n# Added by cz-cli setup\n' >> "$cf"
            if [ "$shell_name" = "fish" ]; then
                echo "fish_add_path $INSTALL_DIR" >> "$cf"
            else
                echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$cf"
            fi
            print_success "Updated $cf"
            [ -z "$_updated_cf" ] && _updated_cf="$cf"
        done
        export PATH="$INSTALL_DIR:$PATH"
        ;;
esac
fi

# Initialize default czcli.json if not present
CZAGENT_CONFIG="$HOME/.clickzetta/czcli.json"
if [ ! -f "$CZAGENT_CONFIG" ]; then
    mkdir -p "$HOME/.clickzetta"
    cat > "$CZAGENT_CONFIG" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false,
  "skills": {
    "paths": ["~/.clickzetta/skills"]
  }
}
EOF
    print_success "Created default config at $CZAGENT_CONFIG"
fi

# Install bundled cz-tool (internal, not on PATH)
CZ_TOOL_DIR="$HOME/.clickzetta/cz-tool"
if [ -d "$SCRIPT_DIR/cz-tool" ]; then
    echo "Installing bundled cz-tool ..."
    rm -rf "$CZ_TOOL_DIR"
    mkdir -p "$CZ_TOOL_DIR"
    cp -r "$SCRIPT_DIR/cz-tool/"* "$CZ_TOOL_DIR/"
    chmod +x "$CZ_TOOL_DIR/cz-tool" 2>/dev/null || true
    if [ "$(uname -s)" = "Darwin" ]; then
        xattr -r -d com.apple.quarantine "$CZ_TOOL_DIR" 2>/dev/null || true
    fi
    # Clean up legacy location
    rm -rf "$INSTALL_DIR/cz-tool"
    print_success "Installed bundled cz-tool to $CZ_TOOL_DIR"
fi

# Install bundled skills for cz-cli internal use
if [ -z "$SKIP_SKILLS_INSTALL" ]; then
SKILLS_DEST="$HOME/.clickzetta/skills"
if [ -d "$SCRIPT_DIR/skills" ]; then
    echo "Installing bundled skills ..."
    mkdir -p "$SKILLS_DEST"
    # Copy all skills except cz-cli subagent skill (that goes to external agents)
    for skill_dir in "$SCRIPT_DIR/skills/"*/; do
        skill_name=$(basename "$skill_dir")
        [ "$skill_name" = "cz-cli" ] && continue
        rm -rf "$SKILLS_DEST/$skill_name"
        cp -r "$skill_dir" "$SKILLS_DEST/$skill_name"
    done
    print_success "Installed bundled skills to $SKILLS_DEST"
fi

# Install cz-cli and lakehouse-doc skills to external AI agents
CZCLI_SKILL_SRC="$SCRIPT_DIR/skills/cz-cli"
LAKEHOUSE_SKILL_SRC="$SCRIPT_DIR/skills/lakehouse-doc"
if [ -d "$CZCLI_SKILL_SRC" ]; then
    AGENT_DIRS="$HOME/.claude/skills $HOME/.codex/skills $HOME/.cursor/skills $HOME/.kiro/skills"
    # Clean up old czcli/czagent skill directories
    for agent_dir in $AGENT_DIRS; do
        rm -rf "$agent_dir/czagent"
    done
    for agent_dir in $AGENT_DIRS; do
        mkdir -p "$agent_dir"
        rm -rf "$agent_dir/cz-cli"
        cp -r "$CZCLI_SKILL_SRC" "$agent_dir/cz-cli"
        if [ -d "$LAKEHOUSE_SKILL_SRC" ]; then
            rm -rf "$agent_dir/lakehouse-doc"
            cp -r "$LAKEHOUSE_SKILL_SRC" "$agent_dir/lakehouse-doc"
        fi
    done
    print_success "Installed cz-cli + lakehouse-doc skills to Claude Code, Codex, Cursor, Kiro"
fi
fi

echo ""
# Check for existing profile (aligned with cz-cli install.sh)
if [ -f "$HOME/.clickzetta/profiles.toml" ] && grep -q '\[profiles\.' "$HOME/.clickzetta/profiles.toml" 2>/dev/null; then
    print_success "Found existing Lakehouse profile"
else
    echo "No Lakehouse connection profile found."
    echo "Run 'cz-cli setup' to configure your connection."
fi

echo ""
echo "Done! cz-cli is ready to use."
echo "Try: cz-cli --help"
