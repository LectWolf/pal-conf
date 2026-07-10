#!/usr/bin/env bash
set -euo pipefail

PAL_CONF_BASE_URL="${PAL_CONF_BASE_URL:-https://pal.started.ink}"

parser_path="${PALWORLD_CONFIG_PARSER_PATH:-./PalworldServerConfigParser}"
tmp_file="${parser_path}.tmp"

curl -fsSL "${PAL_CONF_BASE_URL%/}/scripts/PalworldServerConfigParser" -o "$tmp_file"
chmod +x "$tmp_file"
mv "$tmp_file" "$parser_path"

echo "PalworldServerConfigParser 已更新"
