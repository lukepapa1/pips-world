# Design

Style direction: cosy, warm, calm, storybook village. These four words can change. Until they do, every screen should feel like a paper page in a village, not a dashboard.

Follow this file for all UI work. Tokens below are the target. The app still uses the colours and sizes in `world/src/style.css` until a later change applies them.

## Colour

Light is the default. Dark is a second theme, chosen by the system unless the owner picks one. Season tints the chrome slightly. It does not recolour text, buttons, or status.

### Base, light

| Token | Hex | Use |
| --- | --- | --- |
| `ink` | `#2a241c` | Text |
| `ink-soft` | `#5c5146` | Secondary text. Replaces today's muted `#7a6e60`, which is 4.38:1 on paper. |
| `paper` | `#f6f0e4` | Page |
| `paper-raised` | `#fffaf3` | Cards, fields |
| `line` | `#e4d5c0` | Hairlines |
| `moss` | `#2f6b4f` | Primary action, success |
| `moss-ink` | `#f7f4ee` | Text on moss |
| `navy` | `#2c455c` | Links, selected tab, chat from the owner |
| `clay` | `#8e3b28` | Needs attention. Darker than today's `#c4543a` so light text clears AA. |
| `clay-ink` | `#fffaf3` | Text on clay |
| `sky` | `#b7d4ea` | World backdrop behind the UI |

`ink` on `paper` is 13.5:1. `ink-soft` on `paper` is about 7:1. `moss-ink` on `moss` is 6.3:1. `clay-ink` on `clay` is about 7:1.

### Base, dark

| Token | Hex | Use |
| --- | --- | --- |
| `ink` | `#f6f0e4` | Text |
| `ink-soft` | `#d4c6b4` | Secondary text |
| `paper` | `#241e18` | Page |
| `paper-raised` | `#322922` | Cards, fields |
| `line` | `#4a3d32` | Hairlines |
| `moss` | `#7dba98` | Primary action |
| `moss-ink` | `#1a241c` | Text on moss |
| `navy` | `#b7d4ea` | Links, selected tab |
| `clay` | `#e7a090` | Needs attention |
| `clay-ink` | `#2a1612` | Text on clay |
| `sky` | `#1c2830` | Backdrop |

### Season shift

A wash on `paper` and `sky` only, about 8% toward the season. Text tokens stay put.

| Season | Wash |
| --- | --- |
| spring | `#d7e6c8` blossom green |
| summer | `#f3ddb0` warm hay |
| autumn | `#e7c4a4` leaf |
| winter | `#d5e2ea` frost |

## Typography

Two fonts.

- Heading: Nunito. Rounded and friendly. Weights 600 and 700. Use for titles, tab labels, and buttons.
- Body: Source Sans 3. Clean. Weights 400 and 600. Use for diary-adjacent UI, forms, and lists.

Pip's own words (diary entries and his chat lines) stay in Fraunces, the storybook face already on the page. If a screen cannot load a third face, those lines use the heading font.

| Role | Size | Weight | Line height |
| --- | --- | --- | --- |
| Display | 28px | 700 | 1.2 |
| Title | 22px | 700 | 1.25 |
| Section | 18px | 700 | 1.3 |
| Body | 16px | 400 | 1.45 |
| Label | 14px | 600 | 1.3 |
| Meta | 13px | 600 | 1.3 |

Do not set type below 13px. The current 0.72rem uppercase chips (about 11.5px) are retired.

## Space, radius, shadow

Space, on a 4px grid: 4, 8, 12, 16, 24, 32, 48.

Radius: 8 for fields and thumbnails, 12 for cards, 16 for sheets, 22 for the login card, 999 for pills and the tab bar.

Shadow, light: `0 12px 32px rgba(48, 32, 16, 0.14)`. Dark: `0 12px 32px rgba(0, 0, 0, 0.35)`. One level is enough. Do not stack a second shadow on a card that already sits on paper.

## Motion

Transitions run 150 to 250ms, ease-out. Use them for a sheet opening, a tab underline, and a toast. Do not animate the village clock or the activity list.

`prefers-reduced-motion: reduce` cuts those transitions to 0ms and holds 3D previews still. The pause desaturation already steps aside for reduced motion. Keep that.

## Targets and contrast

Minimum tap target is 44 by 44px, including close, hide, switches, and icon buttons. Visual size can be smaller if the hit area is 44px.

Text, icons, and button labels meet WCAG AA: 4.5:1 for text under 18px, 3:1 for large text and for control boundaries against the page. Do not use `ink-soft` below 14px.

## Components

- Button. Primary (moss), quiet (paper with a line), and danger (clay, for deny and pause). 44px tall, pill radius, heading font at 16px weight 700.
- Card. `paper-raised`, 12px radius, 16px padding. One action row at the bottom.
- Tab bar. Five items maximum, fixed to the bottom, safe-area inset, 44px row plus labels. Selected item uses `navy` in light and `navy` token in dark. One badge, on Inbox.
- Bottom sheet. Phone panels. Radius 16 on the top corners, scrim at 18% ink, a 44px close. Desktop may keep a side sheet of the same content.
- Toast. One line, ink background, paper text, above the tab bar, gone after a few seconds. `role="status"`.
- Empty state. A short title and one sentence about what will show up. No illustration required.
- Skeleton loader. Two or three paper-raised blocks, no shimmer when reduced motion is on. Use while a snapshot or the overview request is in flight.
- Badge. Count on Inbox, and on a card when something inside is unread. Clay fill, clay-ink text, at least 16px tall inside the 44px target.
- Switch. A 44px row. The control itself is a track, not an 18px checkbox. On is moss.

## Voice

Labels are everyday words: Inbox, not Mailbox and Alerts side by side. Graphics, not High. Pause stays Pause. Blueprint names can stay as Pip wrote them, shown with spaces instead of underscores. Empty and error sentences stay as plain as the ones already in the app ("The diary is blank.", "That password was not right.").
