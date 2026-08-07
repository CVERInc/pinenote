# hwdb: sc7a20 accel matrix is matched by chip, and two Pine64 boards mount it differently

**Component:** hwdb (`hwdb.d/60-sensor.hwdb`)
**systemd:** 257 (257.2-3, Debian trixie)
**Hardware:** Pine64 PineNote — `pine64,pinenote-v1.2 pine64,pinenote rockchip,rk3566`,
kernel 6.12.11

## Summary

`60-sensor.hwdb` carries an accelerometer mount matrix for the PineTab2, matched
on the accelerometer's device-tree compatible:

```
# Pine64
#########################################

# PineTab2

sensor:modalias:of:NaccelerometerT_null_Csilan,sc7a20:*
 ACCEL_MOUNT_MATRIX=0, 0, -1; 1, 0, 0; 0, -1, 0
```

The PineNote uses the same `silan,sc7a20` part, mounted in a different
orientation, so it matches this entry too. The match key
(`of:N<name>T<type>C<compatible>`) contains the node name, the type and the chip
compatible — nothing that identifies the board — so as far as we can tell the two
devices cannot be told apart with this key format.

We are not claiming the matrix is wrong for the PineTab2. We do not have one and
have not measured it. The report is that it is applied to a second board where it
does not hold, and that it overrides a matrix the kernel already publishes.

## What it costs on the PineNote

The device tree supplies a mount matrix, visible in sysfs:

```
$ cat /sys/bus/iio/devices/iio:device2/mount_matrix
-1, 0, 0; 0, 1, 0; 0, 0, 1
```

The hwdb entry wins, so udev reports the other one:

```
$ udevadm info /sys/bus/iio/devices/iio:device2 | grep ACCEL_MOUNT_MATRIX
E: ACCEL_MOUNT_MATRIX=0, 0, -1; 1, 0, 0; 0, -1, 0
```

Applied to this board's axes that becomes `x' = -z, y' = x, z' = -y`, which sends
the device's Y axis onto the display's Z. Half of every rotation then reads as
the tablet being laid flat, and iio-sensor-proxy never emits two of the four
orientations.

Measured by logging the raw accelerometer values, the proxy's orientation and the
display transform together, while turning the tablet through four poses:

| gravity on | proxy orientation | display transform |
|---|---|---|
| −Y | normal | 0 |
| −X | normal | 0 |
| +Y | bottom-up | 2 |
| +X | bottom-up | 2 |

Transforms 0 and 2 are both landscape, so the screen never chose portrait at all.
The user-visible symptom is that turning the tablet upright appears to snap back
to landscape.

With the device tree's matrix restored through a local udev rule, the same four
poses give four distinct results:

| gravity on | proxy orientation | display transform |
|---|---|---|
| −Y | normal | 0 |
| −X | left-up | 1 |
| +Y | bottom-up | 2 |
| +X | right-up | 3 |

## Reproducing

Any PineNote with a mainline-ish kernel exposing `silan,sc7a20`. Compare
`/sys/bus/iio/devices/iio:device*/mount_matrix` against the `ACCEL_MOUNT_MATRIX`
udev property on the same device; they disagree.

## Questions rather than a patch

We do not know which of these the project would prefer, and the PineTab2 entry is
presumably there because someone measured it:

1. Is there a match key that distinguishes boards here? The machine identifies
   itself as `pine64,pinenote` in `/proc/device-tree/compatible`, but that does
   not appear in the sensor modalias.
2. Should a mount matrix published by the kernel in sysfs take precedence over a
   hwdb entry, on the grounds that the kernel knows which board it is running on?
   That would fix this class of collision rather than this instance.
3. Or should the entry simply be narrowed once a key exists that can express it?

Locally we restore the kernel's matrix with a udev rule. Notes and the
measurement scripts are at https://github.com/CVERInc/pinenote (MIT), in case any
of it is useful.
