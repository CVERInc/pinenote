#!/usr/bin/env python3
"""Make PNDeb's suspend power-usage recorder survive a battery-path miss.

/usr/lib/systemd/system-sleep/pn_record_power_usage.py looks the battery up by
platform path. Two shipped shapes exist and both can fail on this unit:

  legacy  two hard-coded paths, one containing 'rk817-charger.6.auto'. This
          unit enumerates as .7.auto, so neither exists, the lookup loop never
          assigns bat_dir, and every suspend dies with NameError. That is what
          shipped on our image -- /root/energy_use.dat had never gained a line.
  glob    upstream's fix: glob the instance dir, then assert exactly one match
          and assert it holds a battery. Better, but a miss still raises inside
          a system-sleep hook on every suspend.

Both are replaced by /sys/class/power_supply/rk817-battery -- the stable
symlink the kernel maintains wherever the driver instance lands -- plus a quiet
exit when no battery is found. Sent upstream as PNDeb/pinenote-debian-image#129;
until that lands (and for any older image), setup.sh reapplies it here.

Idempotent: safe to re-run. Leaves the file alone if upstream changes shape.
"""
import io
import sys

TARGET = '/usr/lib/systemd/system-sleep/pn_record_power_usage.py'

MARKER = "'/sys/class/power_supply/rk817-battery'"

LOOP = """bat_dirs = (bat_dir_old, bat_dir_new)
for directory in bat_dirs:
    if os.path.isdir(directory):
        bat_dir = directory + os.sep
        break
"""

OLD_LEGACY = """bat_dir_old = ''.join((
    '/sys/bus/i2c/devices/0-0020/rk817-charger/power_supply/rk817-battery/'
))
bat_dir_new = ''.join((
    '/sys/bus/i2c/devices/0-0020/',
    'rk817-charger.6.auto/power_supply/rk817-battery'
))
""" + LOOP

OLD_GLOB = """bat_dir_old = ''.join((
    '/sys/bus/i2c/devices/0-0020/rk817-charger/power_supply/rk817-battery/'
))
charger_dir = glob.glob('/sys/bus/i2c/devices/0-0020/rk817-charger.*.auto')
assert len(charger_dir) == 1
bat_dir_new = charger_dir[0] + '/power_supply/rk817-battery'
assert os.path.isdir(bat_dir_new)

""" + LOOP

NEW = """# /sys/class/power_supply is the stable interface: the kernel points this
# symlink at the battery wherever the driver instance happens to land, so
# there is no platform instance number to glob for.
bat_dirs = (
    '/sys/class/power_supply/rk817-battery',
    '/sys/bus/i2c/devices/0-0020/rk817-charger/power_supply/rk817-battery',
)
bat_dir = None
for directory in bat_dirs:
    if os.path.isdir(directory):
        bat_dir = directory + os.sep
        break
if bat_dir is None:
    # No battery to read: nothing to record. Leaving quietly beats raising
    # on every single suspend.
    exit()
"""


def main():
    try:
        src = io.open(TARGET, encoding='utf-8').read()
    except IOError as exc:
        print('skip: cannot read %s (errno %s)' % (TARGET, exc.errno))
        return 0
    if MARKER in src:
        print('already patched (or upstream #129 landed)')
        return 0
    for old, shape in ((OLD_LEGACY, 'legacy'), (OLD_GLOB, 'glob')):
        if old in src:
            io.open(TARGET, 'w', encoding='utf-8').write(src.replace(old, NEW, 1))
            print('patched %s (%s shape)' % (TARGET, shape))
            return 0
    print('WARNING: no known shape found in %s -- upstream changed, left alone' % TARGET)
    return 0


if __name__ == '__main__':
    sys.exit(main())
