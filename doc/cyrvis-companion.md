# Cyrvis companion entry point

The first visible window is the transparent desktop companion. The main window
is preloaded with `showInBackground: true` and owns one `VoiceRuntime` instance.
Closing the main window hides it on all platforms; only explicit Quit tears down
voice and both windows. Clicking the companion opens the existing main window.
Dock activation and second-instance launches reveal the companion. GUI task
completion/cancellation returns to the companion without opening the main window.

## Interaction

- The companion allows screen capture so desktop recordings and screenshots can
  include the pet and its conversation bubbles.

- Right-click **Appearance** to choose Cyrvis Robot, three Awesome Codex Pet
  characters, or Jarvis. Selection applies immediately
  and is saved alongside position in `cyrvis-companion.json`; voice snapshots
  cannot overwrite it. Unknown saved IDs fall back to Cyrvis Robot.
- Artwork is bundled locally for offline use. Source commits, attribution,
  integrity hashes and license limitations are documented in
  `apps/ui-tars/resources/cyrvis-companion/skins/README.md`.

- The Cyrvis Robot poses and selected third-party packs are bundled directly in
  application resources so packaged builds include only runtime assets.
- Five interaction states (listening, thinking, speaking, working, sleeping) plus
  the neutral idle pose. Actual audio playback remains speaking after generation
  finishes. User speech takes precedence when interrupting a running task.
- Pointer drag uses the OS cursor in the main process and a five-pixel threshold.
  The drag result is shared between pointer release and click so dragging cannot
  accidentally open history. Position is stored in `cyrvis-companion.json` under
  Electron userData and clamped to an available display when shown.
- Right-click offers open, voice on/off, wake, interrupt, cancel task, audio mode,
  settings, and quit. Hover text distinguishes the microphone state from the pose.
- The companion subscribes to a snapshot published by the sole audio owner. It
  never mounts `useVoiceAudio` itself. Capture remains in the existing isolated
  capture renderer; closing history does not stop it.

## History

The sidebar shows existing sessions and new companion conversations grouped by
Today, Yesterday, and Earlier. The `/history/:id` route reads session and message
IndexedDB stores directly. Browsing does not clear or stop a live task. The input
at the bottom of the conversation pane continues that same chat, preserving its
title, earlier messages, and screenshots. Sending loads that chat's text context,
including plain assistant replies, and starts a fresh execution buffer.

The shared send flow owns message persistence for the duration of a run, so
navigating away does not drop replies. A serialized write queue appends the
current execution buffer to the saved prefix without duplicating messages.
Other chats' inputs remain disabled while the current task is running.

`useVoiceHistory` serializes writes of final transcripts, final assistant text,
and task progress/result events. A session lasts until sleep or application
restart. Writes use existing session/chat stores; BroadcastChannel refreshes the
sidebar and detail pane. Old task records remain readable, including screenshots.
Settings are available from the small sidebar gear and companion menu.

All interface labels are English; saved user and assistant content retains its
original language. New chat is available in the sidebar, welcome page, and chat
headers. It opens an unsaved local-computer draft with the original input flow.
Repeated clicks do not add history entries. The first non-empty send creates the
session, after model configuration and permission checks, using the message as
its title. Opening a new draft is disabled
while a task is active to avoid clearing its execution context.

Each history row has a three-dot menu with Delete and a confirmation dialog.
Deletion removes both the session and its messages/screenshots, returning to the
welcome page when the deleted record was open. It does not clear backend task
history. Deletion is disabled while a task is active.

Live and saved conversations share the original message components. Text and
action steps appear on the left; screenshots, zoom, and timeline controls appear
on the right. Selecting a screenshot in the text pane selects it in the gallery.

## Verification

From repository root:

```sh
pnpm --filter ui-tars-desktop typecheck
pnpm --filter ui-tars-desktop test:companion
UI_TARS_APP_PRIVATE_KEY_BASE64=cyrvis-ui-build-check pnpm --filter ui-tars-desktop build:dist
pnpm --filter ui-tars-desktop test:companion:ui
```

The placeholder build value above is for local verification only; production builds
use their existing configured value.

The focused Vitest config avoids the legacy workspace's missing setup file and
runs companion state tests plus the existing controller, voice-brain, intent,
and proactivity suites; companion tests cover the selected packs.

The UI script uses actual Electron window and renderer code with a temporary
profile, fake voice events, and stubbed settings/update/system integrations. It
checks pet-first visibility, poses, drag versus click, keyboard activation,
open/close behavior, a single audio subscriber, saved conversations, read-only
history browsing, continuation with prior context, saving across navigation,
narrow layout, new-chat creation and sending, screenshot selection,
delete cancellation/confirmation and database cleanup, English labels, and
settings. It prints the temporary screenshot folder.
It does not access the user's microphone, credentials, or stored history.

Actual voice recognition and audio output still require the configured provider
and microphone permissions and must be exercised in the normal application.
The isolated UI check has been run on macOS; Windows/Linux native presentation
has not been exercised.

## Live voice conversation

The companion shows a pair of floating chat bubbles: the user's words on the
left in blue, and the assistant's streaming reply on the right in white with a
speech tail. There is no enclosing card, header or footer. Short messages size to
their content; long replies scroll and remain selectable.

Bubbles appear only during user speech, thinking, assistant playback, or new
transcript/reply events. They stay visible for five seconds after activity ends,
then disappear and the native window returns to its compact size. An idle open
microphone, retained text, connection progress and errors do not keep the bubble
open. Pausing hides it immediately; resuming an idle microphone does not replay
old messages. The next utterance opens a fresh bubble. Finalized turns remain in
history.

Start/Pause and Interrupt controls appear on hover, keyboard focus or during a
conversation. Connection errors remain available in the robot's tooltip; audio
mode selection remains in its right-click menu. The existing hands-free service
and sole main-renderer audio owner are unchanged.

The window grows around its bottom-right anchor and is clamped to the display's
work area. Dragging only starts on the robot, preserving text selection and
button interactions. The upstream voice engine retains its existing headset and speaker interruption behavior.

Validation: focused unit tests, node/web type checks, production build and the
isolated Electron UI harness cover streaming/final text, late ASR, new response
replacement, controls, long text, bounds, idle auto-hide, fresh-turn reopening,
and compact idle/error presentation. Voice events are simulated; real speech
still requires valid Qwen credentials and microphone permissions.

## Companion voices

Each bundled companion selects a Qwen voice: Cyrvis Robot → Tina, Capoo → Ryan,
Bubu → Theo Calm, Agumon → Evan, and Jarvis → Raymond. The appearance store is
shared with the voice service; startup and reconnects use the saved selection.
Switching cancels the old response, flushes buffered playback, and updates the
existing realtime session without dropping conversation context. A paused
microphone stays paused. QWEN_VOICE is superseded by the companion selection.

Qwen3.8 uses `session.audio.output.voice`; other configured realtime models use
`session.voice` and must support these voices. The five voices were verified on
Qwen3.5-Omni-Plus-Realtime with synthetic greetings. The provider tests cover both
parameter layouts, switching during connection, old-audio suppression, and
session updates not waking a paused companion.
