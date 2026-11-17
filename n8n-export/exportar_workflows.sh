#!/usr/bin/env bash
# Exporta todos los workflows de n8n (API pública v1) a archivos JSON.
# Uso: N8N_API_KEY=xxxx ./exportar_workflows.sh [URL_BASE] [DIR_SALIDA]
set -euo pipefail
BASE="${1:-https://n8n-inmo-ceballos.serversvisionarius.com}"
OUT="${2:-$(dirname "$0")/workflows}"
mkdir -p "$OUT"
HDR=()
[ -n "${N8N_API_KEY:-}" ] && HDR=(-H "X-N8N-API-KEY: $N8N_API_KEY")

cursor=""; total=0
while :; do
  url="$BASE/api/v1/workflows?limit=250"
  [ -n "$cursor" ] && url="$url&cursor=$cursor"
  page=$(curl -fsS "${HDR[@]}" "$url")
  n=$(jq '.data | length' <<<"$page")
  for i in $(seq 0 $((n-1))); do
    wf=$(jq ".data[$i]" <<<"$page")
    id=$(jq -r '.id' <<<"$wf")
    name=$(jq -r '.name' <<<"$wf" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-80)
    echo "$wf" > "$OUT/${name}__${id}.json"
    echo "  ✓ $id  $(jq -r '.name' <<<"$wf")"
  done
  total=$((total+n))
  cursor=$(jq -r '.nextCursor // empty' <<<"$page")
  [ -z "$cursor" ] && break
done
jq -s '.' "$OUT"/*.json > "$OUT/../todos_los_workflows.json"
echo "Exportados $total workflows en $OUT (y combinados en todos_los_workflows.json)"
