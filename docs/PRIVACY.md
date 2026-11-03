# Bootbox Privacy Policy

_Last updated: November 3, 2026_

Bootbox is a virtual-machine app for iPad and iPhone. It runs operating systems such as Linux and Android
inside the app. This policy explains what happens to your information when you use it.

## The short version

Bootbox does not collect, store or sell any personal information. It has no accounts, analytics,
advertising or tracking. Everything you do in Bootbox stays on your device unless you send it somewhere
yourself.

## Information we collect

None. The developer receives no data from the app: no usage statistics, identifiers, location, contacts,
photos or files.

## Information stored on your device

- **Virtual machines and their disks.** System images, the files you create inside a virtual machine, and
  saved machine states are stored in the app's storage on your device. Some are visible in the Files app
  under "Bootbox Files". They are included in your device backups according to your iOS settings. Deleting the app
  deletes them.
- **Settings.** Your choices (for example memory size, number of CPU cores and display options) are stored
  on your device.

## Network connections

- **Downloading systems.** When you choose a system for the first time, Bootbox downloads its image from
  the developer's public GitHub releases (github.com). GitHub receives the request, like any web download,
  under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **Internet inside a virtual machine.** The Linux and Android systems reach the internet through a small
  network stack built into the app. Their traffic goes directly from your device to the sites they
  contact. It does not pass through any server run by the developer.
- **Disk images you provide (32-bit engine).** For the 32-bit engine, used with disk images or ISOs you
  supply yourself, internet access passes through a public WebSocket relay operated by a third party
  (relay.widgetry.org, from the open-source v86 project). That relay carries the virtual machine's network
  traffic. You can turn it off in UEFI Firmware Setup → Advanced → Guest Internet.
- **Web links.** Links opened from the Linux browser open in your device's own browser, under that
  browser's privacy policy.

## Camera, microphone and files

Bootbox asks for the camera or microphone only when you use a built-in app that needs it, for example to
take a photo or record a voice memo. Photos and recordings stay on your device. Files you import into
Bootbox stay in the app's storage.

## Crash reports

If you share crash reports and analytics with app developers in your iOS settings, Apple may provide the
developer with anonymous crash logs. Bootbox adds nothing to them.

## Children

Bootbox is not directed at children under 13 and does not knowingly collect information from anyone.

## Changes

If this policy changes, the new version will be posted on this page with a new date.

## Contact

Questions about this policy: Yu Yao-Hsing, euler.yu@gmail.com
