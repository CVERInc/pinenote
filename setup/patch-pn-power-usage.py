#!/usr/bin/env python3
"""Fix PNDeb's suspend power-usage recorder, which crashes on every suspend.

/usr/lib/systemd/system-sleep/pn_record_power_usage.py hard-codes two battery
paths, both containing a platform instance number (rk817-charger.6.auto). That
number drifts between boots/images -- on this unit it is .7.auto -- so neither
candidate exists, the lookup loop never assigns bat_dir, and the script dies
with NameError before recording anything. It has therefore never worked here.

dpkg -S finds no owning package, so a reflash leaves it broken and unmanaged;
this patch is how setup.sh puts it back. Idempotent: safe to re-run.
"""
import io
import sys

TARGET = '/usr/lib/systemd/system-sleep/pn_record_power_usage.py'

OLD = """bat_dirs = (bat_dir_old, bat_dir_new)
for directory in bat_dirs:
    if os.path.isdir(directory):
        bat_dir = directory + os.sep
        break
"""

NEW = """# The rk817-charger platform instance number drifts (.6.auto, .7.auto, ...),
# so both hard-coded paths can miss. Prefer the stable class symlink.
bat_dir_class = '/sys/class/power_supply/rk817-battery'
bat_dirs = (bat_dir_class, bat_dir_old, bat_dir_new)
bat_dir = None
for directory in bat_dirs:
    if os.path.isdir(directory):
        bat_dir = directory + os.sep
        break
if bat_dir is None:
    # No battery found: nothing to record. Exiting quietly beats raising
    # NameError on every single suspend.
    exit()
"""

MARKER = 'bat_dir_class ='


def main():
    try:
        src = io.open(TARGET, encoding='utf-8').read()
    except IOError as exc:
        print('skip: cannot read %s (%s)' % (TARGET, exc.errno))
        return 0
    if MARKER in src:
        print('already patched')
        return 0
    if OLD not in src:
        print('WARNING: anchor not found in %s -- upstream changed, patch skipped' % TARGET)
        return 0
    io.open(TARGET, 'w', encoding='utf-8').write(src.replace(OLD, NEW, 1))
    print('patched %s' % TARGET)
    return 0


if __name__ == '__main__':
    sys.exit(main())
