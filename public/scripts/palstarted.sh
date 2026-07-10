#!/usr/bin/env sh
set -eu

: "${PAL_CONF_BASE_URL:?请设置 PAL_CONF_BASE_URL}"

parser_path="${PALWORLD_CONFIG_PARSER_PATH:-./PalworldServerConfigParser}"
tmp_file="${parser_path}.tmp"

curl -fsSL "${PAL_CONF_BASE_URL%/}/scripts/PalworldServerConfigParser" -o "$tmp_file"
chmod +x "$tmp_file"
mv "$tmp_file" "$parser_path"

echo "PalworldServerConfigParser 已更新"
