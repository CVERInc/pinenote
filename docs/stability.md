# Stability: how the tablet died, 2026-09-10 to 09-15

Part of [pinenote](../README.md).

The persistent journal held six boots when this was read (2026-09-16). Of the five that had
ended, four did not end cleanly. They fail in three distinct ways, and two of them start at
the same instant: waking from suspend. What follows is what the journal shows; anything it
does not show is marked as a guess.

| Boot | Ran | Ended |
|---|---|---|
| 09-10 14:56 → 09-12 13:16 | 46h, 15 suspends | kernel oops on wake (1) |
| 09-12 13:17 → 09-13 14:14 | 25h, 10 suspends | kernel oops on wake (1) |
| 09-13 14:15 → 09-14 13:38 | 23h, 7 suspends | clean reboot |
| 09-14 13:42 → 09-15 22:47 | 33h, 3 suspends / 2 resumes | log stops at `PM: suspend entry` |
| 09-15 22:57 → 09-15 23:35 | 38min, 1 suspend | interrupt storm, then silence (2) |

## 1. The EBC driver cannot get 4 MB on wake, and its error path dereferences NULL

Both oopses are byte-for-byte the same sequence, within one second of `PM: suspend exit`:

```
KMS thread: page allocation failure: order:10, mode:0x40cc1(GFP_KERNEL|GFP_DMA|__GFP_COMP)
 rockchip_ebc_crtc_atomic_check+0x12c/0x2a0 [rockchip_ebc]
 ...
EBC: rockchip_ebc_ctx_free
Unable to handle kernel NULL pointer dereference at virtual address 0000000000000000
```

`order:10` is 1024 contiguous pages. Free memory was 40 MB and 61 MB, but the buddy lists at
the moment of failure had nothing at 4096 kB and at most one block at 2048 kB: after a day or
two of uptime the DMA zone is too fragmented to hand out one 4 MB block, even with plenty
free. The allocation failing is survivable; `rockchip_ebc_ctx_free` on the failure path is
what takes the tablet down. The 2026-09-10 idle-lock resets in [`docs/lock.md`](lock.md) also
stopped at `rockchip_ebc_ctx_release`, so they are probably the same bug reached by a different
route (the panel blanking and re-lighting). The 09-15 22:47 boot that stops at suspend entry
fits the same shape, but left nothing to prove it.

Driver version: `6.12.11-pinenote-202501281646-00249-g211ba27556cc`.

## 2. The accelerometer's interrupt storms after wake

Every boot with a suspend also has a flood of

```
st_sensors_irq_thread: 78 returning IRQ_NONE (0/0/3/10) sc7a20-trigger
```

and the first flood of each boot starts within a second of a resume (later floods in the same
boot need not): 1,300 to 38,000 lines per boot, peaking at 34,000 in one minute. It ends one
of two ways. On three boots the kernel gave up on the line (`irq 78: nobody cared`; 77 on one
of them) and disabled it, which quietly leaves autorotate dead until the next
boot. On 09-15 at 23:35 the machine went first: `/dev/kmsg buffer overrun`, a short power-key
press, and no further log.

`iio-sensor-proxy-resume.service` (autorotate, 2026-09-09) restarts the proxy on every resume,
and the storm often starts in the same second the proxy does, but not always: on 09-13 18:27:58
it starts on the resume line itself. The journal does not reach back before 09-10, so there is
no before-and-after for the accelerometer wiring. Not yet changed.

## 3. Paste that did not work, and a Shift that stayed down

Copy on the tablet, paste into Firefox on the tablet: it failed from the physical keyboard
and the on-screen one alike. Turning off the clipboard relays (see
[`docs/clipboard.md`](clipboard.md)) did not fix it, disabling pn-osk did not fix it, and a
full rollback of both extensions to 0ffc917 with a session restart did not fix it. The
description that found it came from using the thing: *a light tap of the physical Shift locks
it, the same way the on-screen Shift does.* That is not a modifier bug; it is
`org.gnome.desktop.a11y.keyboard stickykeys-enable` set to `true`, which latches every
modifier for the next key on every keyboard and survives any reload. Nothing in this
repository sets it, and nothing on the device recorded who did. It is off again, and `pn`
now warns when it is on. The extensions went back to HEAD.

The relays stay off anyway, so the tablet's own clipboard has one writer while the crashes
above are being judged.

## Reading it again

```sh
sudo journalctl --list-boots
sudo journalctl -b -N -o short-iso -n 40                 # how boot -N ended
sudo journalctl -k -b -N -g 'allocation failure|Unable to handle|nobody cared'
sudo journalctl -k -b -N -g IRQ_NONE | cut -c1-16 | uniq -c | sort -rn | head
```
