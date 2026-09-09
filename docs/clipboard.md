# Clipboard sync

Part of [pinenote](../README.md).

Apple's Universal Clipboard already carries a copy from the iPhone to the Mac. This closes
the last hop: whatever lands on the Mac's clipboard becomes pasteable on the PineNote.

## Why it pulls instead of pushes

The PineNote already has a standing ssh connection to the Mac that needs nothing from a
person — the key is trusted, so it works from a `systemd --user` unit with nobody logged in
anywhere. The other direction does not: Tailscale SSH gates Mac -> PineNote behind an
interactive per-connection check, which a daemon can never get past on its own. So the daemon
lives on the PineNote and polls, rather than on the Mac and pushes.

## The pieces

- **`mac/clip-relay-source`** — runs only for the duration of one ssh session, never
  installed or scheduled on the Mac itself. It polls `pbpaste` every 500ms, and on a change
  writes the new clipboard as one framed record to stdout. Empty clipboards and anything over
  64KB are skipped.
- **`setup/pn-clip-relay`** + **`setup/pn-clip-relay.service`** — the PineNote side. The
  service runs `ssh mac ~/Developer/pinenote/mac/clip-relay-source`, reads records off that
  connection, and pipes each one into `wl-copy`. If the ssh session ends — sleep, a dropped
  tailnet path, the Mac rebooting — it reconnects with exponential backoff (2s, 4s, 8s ... 30s
  cap) rather than spinning.

## Framing

Each record is:

```
<byte-length>\n<raw bytes>
```

Length is counted in bytes, not characters or lines, specifically so a multi-line paste and
any UTF-8 (CJK, emoji — several bytes per glyph) survive without the reader having to guess
where a record ends. Neither side ever puts the payload through a shell variable: command
substitution strips trailing newlines and breaks on a NUL byte, and this has to be byte-exact.
The writer streams from a temp file it can `wc -c`; the reader (`read_frame` in
`setup/pn-clip-relay`) streams straight into `wl-copy` and only ever reads the length itself
into a variable.

`read_frame` is kept independent of ssh so it can be unit-tested on its own:

```sh
printf '5\nhello' | bash -c 'source setup/pn-clip-relay; read_frame 0'
```

## Install

`mac/clip-relay-source` needs nothing installed on the Mac — it is invoked by path over ssh,
so having this repo checked out there (it already is, if you are reading this on it) is
enough. On the PineNote:

```sh
install -m 0755 setup/pn-clip-relay ~/pinenote/setup/pn-clip-relay
install -m 0644 setup/pn-clip-relay.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pn-clip-relay.service
```

`pn cliprelay` reports whether the unit is running and toggles it; see `setup/pn`.

## What to check

```sh
journalctl --user -u pn-clip-relay -b     # timestamps and byte counts only — never clipboard content
wl-paste                                   # what the PineNote's clipboard currently holds
```

## The one thing to know about Universal Clipboard

macOS does not eagerly copy the iPhone's clipboard to the Mac's pasteboard the moment you copy
something on the phone — it fetches on demand, the first time something on the Mac actually
asks to read the pasteboard. `clip-relay-source`'s own poll (`pbpaste`, every 500ms) is exactly
such an ask, so in practice it is what triggers the fetch, and the PineNote sees the phone's
copy on the next poll after that fetch resolves. What this setup cannot promise — there is no
public API for it — is a bound on how long that lazy fetch itself takes over Continuity before
`pbpaste` returns it; that latency is Apple's, not this relay's, and it is the same latency
you would see pasting into any app on the Mac by hand.

## From the iPhone, without the Mac

Everything above needs the iPhone to be physically near the Mac — Universal Clipboard is a
Continuity feature, not a cloud one, and without both devices on the same local network (Wi-Fi
or Bluetooth range) `pbpaste` never sees the phone's copy at all. Away from the Mac, only the
iPhone and the PineNote — this closes the gap with a second, direct path that doesn't touch
the Mac: `setup/pn-clip-inbox`, a small HTTP server on the PineNote that an iOS Shortcut talks
to straight over Tailscale.

It binds only to the PineNote's tailnet IPv4 — never `0.0.0.0`, never the interface Wi-Fi
uses — so the endpoint exists on the tailnet and nowhere else a phone on someone else's network
could reach it. Every request also has to carry an `X-Token` header matching
`~/.config/pn-clip-inbox.token`, generated once at install; wrong or missing token gets a bare
403. `POST /clip` pushes text onto the PineNote's clipboard (`wl-copy`, same as cliprelay);
`GET /clip` reads it back, so the same setup covers PineNote -> iPhone too.

### Install

```sh
pn clipinbox on
```

This installs the script and the systemd unit, mints the token on first run, and enables the
service — then prints the URL and the token once, to type into the Shortcuts below. `pn
clipinbox` reports whether it's running; `pn clipinbox off` stops it.

### Building the Shortcuts

The Shortcuts app has no way to import these from a file that survives review, so build both
by hand, once, on the iPhone. Both need the PineNote's tailnet address (its Tailscale MagicDNS
name, or the IPv4 `pn clipinbox on` printed) and the token from that same output.

**"Send to PineNote"**

1. New Shortcut, name it *Send to PineNote*.
2. Add **Get Clipboard**.
3. Add **Get Contents of URL**. Set the URL to `http://<pinenote-tailnet-address>:8765/clip`,
   method **POST**, and under Headers add `X-Token` -> the token. Set Request Body to
   **File** (or **Text**) and pick the Clipboard output from step 2 as its value — this is
   what puts the copied text on the wire byte-for-byte instead of through a text field that
   can normalize it.
4. Optionally add **Show Notification** ("Sent to PineNote") so a silent 403 or a dropped
   tailnet path doesn't look identical to success.

**"Get from PineNote"**

1. New Shortcut, name it *Get from PineNote*.
2. Add **Get Contents of URL**: same URL, method **GET**, same `X-Token` header.
3. Add **Copy to Clipboard**, fed by the previous step's output.

Attach *Send to PineNote* to whatever makes it reachable in the moment something's already on
the clipboard — the Action Button, a Back Tap gesture, or the share sheet (as an Action
Extension) all work, and any of them beats opening the Shortcuts app first. *Get from PineNote*
is usually worth a Home Screen icon or the same Back Tap slot the send side isn't using, since
you reach for it less often.

### What to check

```sh
journalctl --user -u pn-clip-inbox -b     # method, status, byte count only — never clipboard content
```
