#!/bin/sh
# opencode setup — install from extracted zip to ~/.opencode
# Run from the directory containing this script (same dir as opencode binary).
set -e

INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="czcli"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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

# PATH setup
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
                [ -f "$HOME/.bash_profile" ] && config_files="$config_files $HOME/.bash_profile"
                config_files="$config_files $HOME/.bash_profile"
                ;;
            fish) config_files="$HOME/.config/fish/config.fish" ;;
        esac
        _updated_cf=""
        for cf in $config_files; do
            grep -q "$INSTALL_DIR" "$cf" 2>/dev/null && continue
            mkdir -p "$(dirname "$cf")"
            printf '\n# Added by czcli setup\n' >> "$cf"
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
  },
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "https://zynkapi.com/v1"
      }
    },
    "openai": {
      "options": {
        "baseURL": "https://zynkapi.com/v1"
      }
    }
  }
}
EOF
    print_success "Created default config at $CZAGENT_CONFIG"
fi

# Install bundled cz-tool
if [ -d "$SCRIPT_DIR/cz-tool" ]; then
    echo "Installing bundled cz-tool ..."
    CZ_TOOL_DIR="$INSTALL_DIR/cz-tool"
    rm -rf "$CZ_TOOL_DIR"
    mkdir -p "$CZ_TOOL_DIR"
    cp "$SCRIPT_DIR/cz-tool/cz-tool" "$CZ_TOOL_DIR/cz-tool"
    chmod +x "$CZ_TOOL_DIR/cz-tool"
    if [ "$(uname -s)" = "Darwin" ]; then
        xattr -r -d com.apple.quarantine "$CZ_TOOL_DIR" 2>/dev/null || true
        codesign --force --sign - "$CZ_TOOL_DIR/cz-tool" 2>/dev/null || true
    fi
    print_success "Installed cz-tool to $CZ_TOOL_DIR"
fi

# Install bundled skills for czcli internal use
SKILLS_DEST="$HOME/.clickzetta/skills"
if [ -d "$SCRIPT_DIR/skills" ]; then
    echo "Installing bundled skills ..."
    mkdir -p "$SKILLS_DEST"
    # Copy all skills except czcli subagent skill (that goes to external agents)
    for skill_dir in "$SCRIPT_DIR/skills/"*/; do
        skill_name=$(basename "$skill_dir")
        [ "$skill_name" = "czcli" ] && continue
        rm -rf "$SKILLS_DEST/$skill_name"
        cp -r "$skill_dir" "$SKILLS_DEST/$skill_name"
    done
    print_success "Installed bundled skills to $SKILLS_DEST"
fi

# Install czcli subagent skill to external AI agents
CZCLI_SKILL_SRC="$SCRIPT_DIR/skills/czcli"
if [ -d "$CZCLI_SKILL_SRC" ]; then
    AGENT_SKILL_DIRS="
        $HOME/.claude/skills/czcli
        $HOME/.codex/skills/czcli
        $HOME/.cursor/skills/czcli
    "
    for dest in $AGENT_SKILL_DIRS; do
        mkdir -p "$(dirname "$dest")"
        rm -rf "$dest"
        cp -r "$CZCLI_SKILL_SRC" "$dest"
    done
    print_success "Installed czcli skill to Claude Code, Codex, Cursor"
fi

echo ""
echo "Done! czcli is ready to use."
echo "Try: czcli --help"
