#!/bin/bash
set -euo pipefail

FILE="meta.json"
if [ ! -f "$FILE" ]; then
  echo "❌ $FILE bulunamadı!"
  exit 1
fi

TS=$(date -u +"%Y-%m-%dT%H:%M:%S.%7NZ")
NEWVER="${1:-}"
CLEAN="$(mktemp)"
grep -vE '^\s*//' "$FILE" > "$CLEAN"

if command -v jq >/dev/null 2>&1; then
  if [ -n "$NEWVER" ]; then
    jq --arg ts "$TS" --arg ver "$NEWVER" \
      '.timestamp = $ts
       | .version = $ver
       | .imagePathLinux   = ("/var/lib/jellyfin/plugins/JMSFusion_" + $ver + "/icon.png")
       | .imagePathWindows = ("%ProgramData%/Jellyfin/Server/plugins/JMSFusion_" + $ver + "/icon.png")' \
      "$CLEAN" > "${FILE}.tmp"
  else
    jq --arg ts "$TS" '.timestamp = $ts' "$CLEAN" > "${FILE}.tmp"
  fi
  mv "${FILE}.tmp" "$FILE"
else
  echo "⚠️ jq yok; sed ile güncelliyorum."
  sed -E -i "s#\"timestamp\"\\s*:\\s*\"[^\"]*\"#\"timestamp\": \"$TS\"#g" "$FILE"

  if [ -n "$NEWVER" ]; then
    sed -E -i "s#\"version\"\\s*:\\s*\"[^\"]*\"#\"version\": \"$NEWVER\"#g" "$FILE" || true
    if grep -qE "\"imagePathLinux\"" "$FILE"; then
      sed -E -i \
        "s#(\"imagePathLinux\"\\s*:\\s*\")/var/lib/jellyfin/plugins/JMSFusion_[^\"]+/icon\\.png(\")#\1/var/lib/jellyfin/plugins/JMSFusion_${NEWVER}/icon.png\2#g" \
        "$FILE" || true
    else
      sed -E -i "s#}\\s*$#,\n  \"imagePathLinux\": \"/var/lib/jellyfin/plugins/JMSFusion_${NEWVER}/icon.png\"\n}#g" "$FILE" || true
    fi
    if grep -qE "\"imagePathWindows\"" "$FILE"; then
      sed -E -i \
        "s#(\"imagePathWindows\"\\s*:\\s*\")%ProgramData%/Jellyfin/Server/plugins/JMSFusion_[^\"]+/icon\\.png(\")#\1%ProgramData%/Jellyfin/Server/plugins/JMSFusion_${NEWVER}/icon.png\2#g" \
        "$FILE" || true
    else
      sed -E -i "s#}\\s*$#,\n  \"imagePathWindows\": \"%ProgramData%/Jellyfin/Server/plugins/JMSFusion_${NEWVER}/icon.png\"\n}#g" "$FILE" || true
    fi
  fi
fi

rm -f "$CLEAN"

echo "✅ meta.json güncellendi:"
echo "   timestamp       = $TS"
[ -n "$NEWVER" ] && {
  echo "   version         = $NEWVER"
  echo "   imagePathLinux  = /var/lib/jellyfin/plugins/JMSFusion_${NEWVER}/icon.png"
  echo "   imagePathWindows= %ProgramData%/Jellyfin/Server/plugins/JMSFusion_${NEWVER}/icon.png"
}
