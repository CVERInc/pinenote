#!/usr/bin/env bash
# Typing Mode 的行為核心：打字時不打斷你，停手才清殘影。
# A2 負責打字順；停手 IDLE_MS 毫秒後用 GC16 徹底清一次。
IDLE_MS=${1:-3000}
dirty=0
while true; do
  idle=$(gdbus call --session --dest org.gnome.Mutter.IdleMonitor \
    --object-path /org/gnome/Mutter/IdleMonitor/Core \
    --method org.gnome.Mutter.IdleMonitor.GetIdletime 2>/dev/null | grep -oE "[0-9]+")
  [ -z "$idle" ] && { sleep 2; continue; }
  [ "$idle" -lt 1000 ] && dirty=1
  if [ "$idle" -ge "$IDLE_MS" ] && [ "$dirty" -eq 1 ]; then
    dbus-send --system --dest=org.pinenote.ebc /ebc org.pinenote.ebc.TriggerGlobalRefresh 2>/dev/null
    dirty=0
  fi
  sleep 1
done
