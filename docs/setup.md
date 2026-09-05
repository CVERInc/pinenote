# setup/

Part of [pinenote](../README.md).

## When the ghosting stops clearing

Half of this design is *not clearing* while you type. That half never breaks loudly — so when
the other half dies, the symptom is simply a screen that slowly becomes unreadable, with no
error anywhere you would think to look. Both halves of that failure happened here, and both
were silent for days:

1. **`pinenote-dbus-service` panics at boot.** It reads
   `/sys/devices/platform/gpio-keys/power/wakeup` while checking travel mode, and `gpio-keys`
   (the magnetic cover switch) can lose a boot-time race with its GPIO controller:

   ```
   gpio-keys gpio-keys: error -ENXIO: Unable to get irq number for GPIO 0
   ```

   A device that never probed has no `power/wakeup`, so the service exits 101 and
   `org.pinenote.ebc` never reaches the bus — and `TriggerGlobalRefresh` has no listener.
   Rebinding after boot always works, which is what the drop-in in `setup/` does.

2. **The idle daemon parsed its own input wrong.** GNOME's idle monitor answers
   `(uint64 342896,)`, and a `grep -oE '[0-9]+'` over that returns **two** numbers — the `64`
   in `uint64` first. Every comparison then failed with *integer expression expected*, roughly
   174,000 times per boot, straight into the journal. The refresh never fired once.

If ghosting stops clearing, check these in order:

```sh
systemctl status pinenote-dbus-service          # exit 101 => the gpio-keys race
journalctl --user -u pn-idle-refresh -b         # the daemon now says so when it cannot refresh
pn_trigger_global_refresh                       # does a manual clear still work?
```

The general lesson is worth more than either bug: **a component whose job is to stay quiet
needs to be loud when it fails.** The evidence for both was sitting in the journal the entire
time. Nobody had a reason to look, because nothing ever said anything was wrong.

## setup/lifeline.sh

The five settings that decide whether you can service this device from another machine at
all. They are separate because three of them need something only you can supply, and one of
them is a security trade-off nobody should inherit silently.

| | Needs | Default |
|---|---|---|
| Persistent journal | nothing | **applied** — stock journald is volatile, so the log of a crash dies with the crash |
| SSH authorised key | `PINENOTE_SSH_PUBKEY` | skipped |
| Wi-Fi connection | `PINENOTE_WIFI_SSID`, `PINENOTE_WIFI_PSK` | skipped |
| Passwordless sudo | `PINENOTE_NOPASSWD_SUDO=1` | skipped — read the block first |
| Wi-Fi powersave off | nothing | **applied** — see below |

Three findings worth keeping even if you write your own:

- On a **WPA2/WPA3 transition** network, nmcli's shorthand and an explicit `sae` both fail to
  associate. It has to be `wifi-sec.key-mgmt wpa-psk`.
- `nmcli connection add` **over SSH** fails with *Insufficient privileges* — polkit grants
  NetworkManager writes to an active local session, and an SSH login is not one. Use `sudo`,
  which is the better answer regardless: a root-owned system connection comes up at boot
  without waiting for a login.
- **The tablet says it is connected and answers nothing.** It shows the same IP, but another
  machine cannot even get an ARP reply — and ARP is layer two, so that rules out routing,
  firewalls and a changed address in one go. The Wi-Fi chip is asleep: the association is
  still there, it just does not respond to unsolicited frames, and any packet it sends
  itself wakes it. Loading a web page on the glass is enough to bring it back. On a device
  whose main use is being maintained over SSH the default is simply wrong, so
  `wifi.powersave = 2` goes into `NetworkManager/conf.d`. The block reports
  `iw dev wlan0 get power_save` rather than declaring success, because writing the file
  does not re-apply it to an association that already exists.

  Do not reconnect the interface over SSH to apply it. `nmcli device disconnect` cuts the
  connection you are giving the command through, and nothing runs the second half.

## setup/pn

One command that shows the state of everything this repository added, and
switches the parts that have a switch. It owns no state: each feature's truth
stays where it lives — gsettings, a systemd unit, `~/.config/*.json`, sysfs —
and `pn` is a single door onto all of them. That is also why it reports what
*is* rather than what is configured: Wi-Fi powersave is asked of `iw`, the input
method of `ibus`, the waveform of sysfs. This device has been bitten by the
difference before.

```
pn                          everything, current state
pn wifi off                 typing / idle / osk / panel / wave / k6 / wifi
pn ime add chewing          into the cycle, in tap order — or rm
pn buttons rotate off       any of input / tone / refresh / rotate
pn reload                   restart gdm3, and again if the greeter wins the race
```

`pn buttons` writes `~/.config/pn-panel.json` and bounces the extension; a
button that is off is not built at all rather than built and hidden, because a
hidden button still holds its name in `statusArea` and the child-added guard
keeps re-hiding it. `pn ime add` proved the `sources-changed` path on the
device for the first time: the fourth source got its label and GNOME's own
indicator stayed hidden, with no restart.

## The picture it sleeps under

The PINE64 still life you are left staring at after you press lock is not a GNOME lock screen,
and the setting that looks like it should change it does nothing: `org.gnome.desktop.screensaver
picture-uri` is a dead key — GNOME Shell reads only `user-switch-enabled` out of that schema.
The lock screen's *own* background is your desktop wallpaper with a blur of radius 90 and
brightness 0.65 hardcoded in `unlockDialog.js`, which on e-ink is a field of grey noise.

The still life comes from a layer below all of that. As the panel powers down the EBC driver
pushes `/lib/firmware/rockchip/rockchip_ebc_default_screen.bin` straight at the controller —
1872x1404, 4 bits per pixel, two pixels to a byte, exactly 1,314,144 of them. It is 1:1 with
the physical pixels: no blur, no clock, no unlock dialog, and it stays there for days, because
the picture survives the power going away. `setup/offscreen/` turns a photograph into one.

Writing that file is not, on its own, enough to change the picture — see the first bullet
below. That took a reboot to find out.

![A cat, as the PineNote sleeps under it](../setup/offscreen/example.png)

*16 grey levels, Floyd–Steinberg, no blur and no clock, held in landscape. Shown at half size
and re-dithered at that size — scaling an already dithered image is how you get moiré. The
real buffer is 1404x1872, 1:1 with the panel. The maintainer's cat, published at the
maintainer's insistence.*

Four things are worth knowing before you make your own:

- **The file the driver reads is the one in the initramfs.** `rockchip_ebc` is a module packed
  into the initramfs and it probes at t+1.3s, so `request_firmware` is answered from there, not
  from the root filesystem you just wrote to. The initramfs was built with the stock picture in
  it, which means your picture is read exactly never — and nothing tells you, because from the
  driver's side nothing failed. It looks correct for as long as the machine stays up, since the
  runtime call below is what put it on the panel, and it is gone after the next boot. `setup.sh`
  therefore also installs `pn-offscreen.service`, which re-applies the picture through that same
  runtime call once the bus is up. Making the file itself authoritative means regenerating the
  initramfs — `PINENOTE_OFFSCREEN_INITRAMFS=1 setup/setup.sh`, opt-in on purpose, because this
  device's only recovery path is maskrom and an initramfs is a thing you can get wrong.
- **The buffer is stored mirrored.** Upright frame to panel is `-flop -rotate 90`, and the
  stock image is the proof — it only comes back readable through exactly that pair. Verify
  against it rather than reasoning about it; `pnimg.py selftest` re-encodes the stock PNG and
  checks it byte for byte against the stock buffer.
- **You do not have to reboot to look.** `org.pinenote.ebc.SetOfflineScreenFromFileTemporary`
  swaps the picture at runtime. On this device that is not a convenience: every reset path
  ends in the machine losing power, and only the physical button brings it back, so "reboot to
  see whether that brightness was right" costs a person walking over to the desk.
- **Your monitor will lie to you about tone.** 16 levels, and a reflective white that returns
  maybe 40% of the light — an image that looks well separated on a laptop arrives flat and
  grey in the hand. The script prints a distribution instead: median for how grey it is,
  near-white for how much highlight detail got flattened, and p1 for whether anything still
  reads as black. Brightening via the white point and brightening via gamma move different
  numbers, and only one of them costs you the fur.

One quieter trap: dither against the 16 levels the buffer can actually hold (0, 17, ... 255).
Dither to anything else and the encoder quantises a second time, undithered — which turns a
carefully dithered gradient straight back into banding, after you already paid for it.

