# UI audit

Read of the owner world on 27 November 2026. This is a description of the screens as they are. Nothing in the app was changed for this audit.

The owner UI lives in `world/index.html`, `world/src/style.css`, and the panel modules under `world/src`. Login, the public creations page, and the offline page are separate HTML strings. There is no settings screen. Owner controls are spread across the top bar and three panels.

Buttons are at least 40px tall. Close, feed Hide, and digest Older/Newer are 32px. The design target in `DESIGN.md` is 44px.

## World HUD

What it shows. The 3D village (Home, Library, Workshop, Gallery, Mailbox), Pip, building signs, and a speech bubble when chat is open. The top bar shows the title, a connection dot with "Connecting…" or day and hour, the village clock, the season, and a chip while he is browsing. A pause banner sits under the bar. An activity feed sits at the bottom left and lists recent events, with a note when older events are stored but not shown.

Actions. Orbit and pinch zoom on the village. Tap a building: Home opens the diary, Mailbox opens the mailbox, and a creation opens its card. Tap Pip's chat path to open chat. Hide or show the feed. Twelve top-bar buttons: Digest, Chat, Diary, Mailbox, Blueprints, Growth, Creations, Overview, Pause, Alerts, Log out, and High/Low graphics.

Problems. On a phone the twelve buttons wrap across the sky and push the digest down (`#digest` starts about 128px from the top). The village is hard to see and hard to reach. "High" does not say graphics until the accessible name. "Growth" does not say what it changes. The feed, the pause banner, and any open panel compete for the same lower half. Feed rows are not tappable. The speech bubble is 12px on a phone. There is no skeleton while the first snapshot is loading, only "Connecting…".

## Activity feed

What it shows. Newest events in the loaded window, grouped by day, with a kind chip, hour, time, and up to four lines of text. Empty: "The village is quiet."

Actions. Hide / Show.

Problems. It is a second, always-on log beside Diary, Overview, and the digest. On a phone it spans the full width and covers the ground Pip stands on. Hide is a 32px target.

## Diary

What it shows. Diary entries, newest first, grouped by day. Unread entries have a clay bar. Empty: "The diary is blank." Opening the panel marks entries read.

Actions. Close. No search, no jump to a day, no link from a line to the hour in the world.

Problems. Journal entries are stored and appear as feed lines, and they have no screen of their own. The panel is a right-hand drawer. On a phone it becomes a sheet that still starts below the crowded top bar, so the close control sits under the buttons. Diary text is Fraunces at about 16px, which is comfortable. The day heading is 0.78rem uppercase in muted ink, which is small.

## Mailbox

What it shows. Requests Pip has made, with title, body, and status (pending, approved, denied). Empty: "No requests yet." The subtitle says "Requests waiting for you" even when the list is old decisions.

Actions. Approve and Deny on a pending request. Close.

Problems. Approve and Deny are clear and large enough (about 108px wide). The mailbox is one of three places that need the owner (with blueprint approval and the digest), and the top bar only badges the mailbox. Pending blueprint approvals and an unread digest are separate buttons.

## Chat

What it shows. A thread with Pip. His lines are on the left in Fraunces. The owner's lines are on the right in navy. Empty: "Pip is listening."

Actions. Type and Send. Close. A prompt placeholder: "Say something to Pip."

Problems. On a phone the panel starts at 58% of the height, which is close to a sheet, and the field is 40px tall. Send is a text button, not an icon, so a long placeholder plus Send gets tight. Chat is a peer of Diary in the top bar even though it is a conversation with the village, not a record.

## Digest

What it shows. One day's summary: headline, day label, and sections such as Built, Learnt, Made, and Wants. Older and Newer move between days. Empty: "No day summarised yet" and "A digest appears at the end of a day."

Actions. Older, Newer, Close. Links inside the summary.

Problems. It opens on its own and covers the middle of the village. Older and Newer are 32px. It is not grouped with the other things waiting for the owner. On a phone the card starts lower because the top bar is taller, so the summary is a short strip.

## Creations

What it shows. Storage used against the budget, a warning at 80%, filters for type, season, status, and starred, then a grid of cards. A card opens a detail: notes, version compare, diary quotes, download, star, mark public, archive. Empty filter: "Nothing in this filter." Before the snapshot: "Connecting…".

Actions. Save storage budget, save the per-creation maximum, toggle the public page, filter, open, star, archive, publish, unpublish, download a version zip.

Problems. Budget and publicity are owner settings sitting above the library, so the first screenful on a phone is forms. "Mark public" is easy to miss beside archive. Cards are the right idea. There is no skeleton, only a connecting line. Archived work is a filter value, which is easy to confuse with finished.

## Overview

What it shows. Five tabs.

- Now: day number, place, latest event, season and village time, the current creation with a thumbnail, and the last five diary lines.
- Mind: interests (the file, or cards once a structured list exists), a hobby badge when the server calculates one, identity with version history, and domains and topics from the last 7 days.
- Making: projects, creations, and recent builds. A creation opens the Creations detail. Projects and builds expand in place.
- Blueprints: a grid with a 3D preview, live version, and how many objects use it. Detail has a before/after slider, version notes, and rollback.
- Stats: days, ticks, diary, builds, creations, pages read, today's model calls against the cap, estimated spend, and a bar of events per day.

Actions. Switch tabs, page forward, open a creation, roll a blueprint back, close.

Problems. Overview is full screen on a phone, which is the right shape, and a wide drawer on a desktop. The same blueprints also have their own top-bar panel, so version history exists twice. Tabs sit in the scrolling body. Interest prose is one card of raw markdown until he sends a structured list. Stats spend is labelled an estimate, which is clear. Loading is a sentence, not a skeleton. "Pages read" stays 0 when he has only searched, and the searches live on Mind, so the two numbers look like they disagree.

## Blueprints panel

What it shows. A checkbox for approval, then each blueprint's versions with Live, Waiting, or Earlier, and who made it. Empty: "No blueprints yet."

Actions. Require approval. Approve a waiting version. Roll back an earlier version. Close.

Problems. Names are snake_case (`flower_patch`). Rollback does not show the shape, the note, or a before/after. That lives on Overview. Two doors to the same job.

## Growth

What it shows. Pace (Calm 60 min, Active 30 min, Fast 15 min), awake or asleep, awake hours, slot list, model calls, page reads, searches, open studies, note count, topics this week, and both model names. Empty studies: "No study is open." Before data: "Connecting…".

Actions. Set pace, save awake hours, save the daily page-read cap, end a study. Close.

Problems. This is owner machinery in the same row as Diary. Number fields for hours and caps are easy to mistype and have no visible unit on the hour fields beyond the label. The slot list is one long paragraph. Model names are useful and easy to skim past. There is no confirm on End.

## Alerts

What it shows. A note about this device, four switches (daily digest, new mailbox request, Pip finished a project, the server went quiet), and a test button. The enable button appears when push can be turned on.

Actions. Turn on notifications, toggle each kind, send a test, close.

Problems. The switches are 18px checkbox squares, under a 44px target. Alerts are settings, and they also represent things waiting (a new digest, a new request), which the top bar does not collect in one badge. "Pip's server went quiet" is clear. The panel title "Alerts" sounds like an inbox and opens a settings form.

## Pause, graphics, log out

What they show. Pause becomes Resume and a banner reads "PAUSED". On a phone the banner hides the sentence and keeps only PAUSED. Graphics toggles the label High / Low. Log out posts to `/logout` and returns to the login page when a password is set.

Actions. Those three buttons.

Problems. They sit in the same wrapping row as Pip's life. High/Low is jargon. There is no menu that groups them.

## Login

What it shows. A centred card: "Pip's World", a short line, and a password field. Wrong password: "That password was not right." Too many tries: "Too many attempts. Wait a few minutes and try again." If no password is set, the page says so and links back.

Actions. Enter. Back to the world, when login is off.

Problems. It uses Georgia and Avenir, not the village fonts. The field and button are close to 40px. It is otherwise the calmest screen in the app. Error text is plain language.

## Public creations page

What it shows. Served at `/public` only when the owner has turned the public page on. A line "AI-made", the heading "Finished creations", and cards for published work (image, title, type, season, description). Empty: "Nothing is public yet." When the flag is off, the route says "This page is off."

Actions. None. It is a read-only page. Images link nowhere.

Problems. It does not use the village type, spacing, or cards. Cards are a fixed 14rem row, so a phone gets horizontal overflow. There is no season colour, no dark mode, and no way back to a safer public overview (`PUBLIC_OVERVIEW` is off, and `/public/overview` is 404).

## Offline

What it shows. "Pip's village is waking up" and a line that the path is quiet until the connection returns.

Actions. None.

Problems. Same calm card as login, and no retry button. That is acceptable for a service-worker fallback. It should pick up the same type and colour tokens when the design system is applied.

## Cross-cutting

- Tap targets. Global buttons are `min-height: 40px`. Close, Hide, and digest paging are 32px. Alert checkboxes are about 18px. The 44px rule is not met.
- Clutter. One top bar holds life (diary, chat, creations), work to approve (mailbox, digest, blueprints), and device controls (pause, alerts, graphics, log out).
- Labels. Growth, High, and snake_case blueprint names assume the builder's vocabulary. Mailbox's subtitle does not change when nothing is waiting.
- Loading. Connecting sentences in the clock, Growth, and Creations. Overview uses a sentence. No skeleton.
- Empty states. A muted sentence, and no hint of what will appear later. They are honest, and they are easy to miss.
- Phone reach. Primary actions are in the top bar. The thumb rests at the bottom, where the feed already sits. Panels dock to the right and, under 800px, become full-width sheets that still clear the top bar. Only Overview goes truly full screen.
- Contrast, measured on the current tokens. Ink `#2a241c` on paper `#f6f0e4` is 13.5:1. Navy `#2c455c` on paper is 8.8:1. Muted `#7a6e60` on paper is 4.38:1, under the 4.5:1 AA line for normal text, and it is used at 0.72rem. Paper `#f7f4ee` on clay `#c4543a` is 4.09:1, so white-on-clay badges and the pause button fail AA. Moss `#2f6b4f` with white is 6.3:1 and passes.
- Motion. The only reduced-motion rule turns off the pause filter. Panels do not animate. The blueprint previews rotate and do honour reduced motion.
- Theme. Light paper only. No dark mode. Season changes the 3D light, not the UI chrome.

## Phone-first information architecture

This is a proposal. It is not built.

A bottom tab bar, at most five items, sitting in the thumb zone above the safe area:

| Tab | What moves here |
| --- | --- |
| World | The village, the season and clock, the short activity feed, and the pause banner. |
| Overview | The five Overview tabs, including blueprints. The separate Blueprints button goes away. |
| Diary | The diary. Journal entries belong here later, since they already exist in the data and have no screen. |
| Creations | The library and the detail card. Storage budget and the public switch move to the menu. |
| Inbox | Everything that needs the owner, with one badge. |

Inbox gathers, in one list:

- Mailbox requests still pending, with Approve and Deny.
- Blueprint versions waiting for approval.
- A new digest, opening the summary that exists today.
- Alert status worth a look (a test is not an inbox item; the switches stay in the menu).

The badge is the count of pending requests, pending blueprint approvals, and unread digests.

World keeps a floating chat button, above the tab bar, so a conversation is one thumb reach and does not take a tab. Chat stays a sheet over the village.

A menu icon on World (and available from the other tabs) holds settings: Pause, Growth pace and caps, alert switches, graphics quality, log out, creation storage, and the public-page switch. Those leave the tab bar.

What this removes from the top of the sky: Digest, Chat, Diary, Mailbox, Blueprints, Growth, Creations, Overview, Pause, Alerts, Log out, and High. The top of World keeps the title, the clock, and the season.
