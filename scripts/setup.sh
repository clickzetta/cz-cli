#!/bin/sh
# opencode setup — install from extracted zip to ~/.opencode
# Run from the directory containing this script (same dir as opencode binary).
set -e

INSTALL_DIR="${HOME}/.clickzetta/bin"
BINARY_NAME="czcode"
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
            printf '\n# Added by czcode setup\n' >> "$cf"
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

# Initialize default czcode.json if not present
CZCODE_CONFIG="$HOME/.clickzetta/czcode.json"
if [ ! -f "$CZCODE_CONFIG" ]; then
    mkdir -p "$HOME/.clickzetta"
    cat > "$CZCODE_CONFIG" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false,
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
    print_success "Created default config at $CZCODE_CONFIG"
fi

# Install cz-cli
if ! command -v cz-cli >/dev/null 2>&1; then
    echo "Installing cz-cli ..."
    curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh
    print_success "Installed cz-cli"
fi

echo ""
echo "Done! czcode is ready to use."
echo "Try: czcode --help"
