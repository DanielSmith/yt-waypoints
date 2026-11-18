# Behavior and technical reference

Wondering what happens when you paste a backup, delete a bookmark, or copy a
transcript? This guide explains those details, including a few things that can
help when something doesn't work as expected.

For a first look at Waypoints and its Settings, start with the [README](../README.md).

## Playback controls

You can use Waypoints to adjust an open video without returning to its tab.
The help table shows your current arrow-key scrub distance and Shift multiplier,
so you don't have to remember what you chose in Settings.

For a closer look at a moment, press comma or period to step backward or forward
by one frame. Waypoints uses the video's reported frame rate and pauses playback
for you. The video stays paused afterward, ready for another step.

To change playback speed, use `<` or `>` (Shift + comma or period), just as you
would on YouTube. Waypoints uses the speeds supported by YouTube's player. If
that interface isn't available, it adjusts the video element's speed in
quarter-speed steps instead.

Frame stepping and speed changes need an open video; they won't open one for
you or move a closed video's saved resume point. Arrow-key and progress-bar
scrubbing can also update a closed video's saved position.

If a video is loading, showing an ad, or missing its player, Waypoints tells you
which situation it encountered. Script failures also get their own message.
Behind the scenes, playback commands run in the YouTube page's own JavaScript
context, with a compatibility fallback for Firefox versions before 128.

While you're typing in search, letter shortcuts let you keep typing normally.
Command/Ctrl/Alt combinations are left alone too. To copy one row, focus it
first; **Shift+C** can copy all bookmarks from Settings as well. These copy
commands don't need additional clipboard permissions.

## Transcript extraction

Select a bookmark row and press **Shift+T** to copy its transcript. The default
is **Markdown with linked timestamps**, with the video title and source URL at
the top. Lowercase **t** still toggles thumbnails.

Waypoints gets the transcript from YouTube itself. It can open YouTube's
transcript panel when available, though you may need to choose **Show transcript**
on YouTube first. It doesn't use a third-party transcript service, a developer
API key, or speech recognition.

### Getting the whole transcript

YouTube may show only a small part of a long transcript at once. Waypoints
requests the complete structured response rather than copying just the rows
currently on screen. It uses the page's request information for that video and
language: the older layout supplies a selected-language token, while newer
panels use YouTube's `/get_panel` request.

Before copying, Waypoints checks that YouTube has finished returning a supported
response. If the response is still loading, uses an unknown layout, or fails
because of a network problem, you'll see an error. Changing videos or languages
during the request also stops the copy. In these cases, Waypoints doesn't put
an incomplete transcript on your clipboard or offer it as a file.

### How timestamps are handled

Exports use YouTube's supplied millisecond timing. When an entry has both a
start and an end, SRT, WebVTT, and JSON keep that end time, shortening overlaps
at the next entry's start and trimming caption padding at the known video end.
Entries with the same start time are joined. The last entry isn't stretched
through any silence left at the end of the video.

Some newer transcript panels supply paragraph start times without end times.
You can still copy every passage as Markdown or plain text. JSON keeps those
passages too, with `null` for the missing ends. SRT and WebVTT need end times,
so Waypoints explains which other formats you can use for those videos. If
YouTube supplies every end time, the video's total duration isn't needed.

Transcript JSON and bookmark-backup JSON serve different purposes. A transcript
JSON file contains timed text; it can't be used to restore your bookmark list.

## Bookmark search

Plain text matches titles and saved tags. With **Include channel names in
search** enabled, it also matches channel names and handles. Use `.tag` to
match an exact tag, `+` for both conditions, `|` for either, and `-` to exclude.
Parentheses group conditions. Enter a saved macro as `@name`.

An exact saved macro name wins over a standalone handle. If no macro matches,
a standalone handle searches as text. Use double quotes around the whole query
to force text search, for example `"@Business"`. Grouping such as `(@watchlist)`
explicitly requests a macro, so a missing name produces a query error.

Queries without refiners keep the usual recency order, with current bookmarks
above visible trash. A refined result keeps the evaluator's order and stays
stable through playback updates. **Refresh** reruns it with current data.
Deleted or hidden rows disappear without replacement until refresh. Showing or
hiding trash rebuilds the eligible set. Changing an active macro requires a
refresh, and a malformed query shows an error distinct from an empty result.

## Bookmark transfer and validation

Use **Copy JSON** or **Shift+C** when you want a backup or want to carry your
bookmarks to another browser. The copy includes **all current bookmarks**, even
those hidden by a search, along with their titles, saved positions, durations,
update timestamps, and available channel details. Trash and browser preferences
stay out of the copy. A full backup also includes the saved macro library when
it contains definitions, and a single-bookmark copy includes only that video
and its tags. Transfers happen when you copy and paste them; there is
no automatic browser sync.

### What happens when you paste a backup

Waypoints merges the pasted bookmarks into your collection:

- New videos are added. Videos that aren't in the backup stay in your list.
- For a video already in your list, **the pasted position wins**. For example,
  if this browser saved a video at 20 minutes and your backup says 12 minutes,
  importing sets its resume point to 12 minutes, even if the local save is newer.
  Missing title, channel, or duration details can be filled from the local copy.
- If that video is open, Waypoints also moves its player to the imported
  position while keeping it playing or paused. A player that's still loading
  gets a saved instruction to apply that position before autosaving.
- Pasting the same backup again doesn't create duplicates or change identical
  bookmarks. It does ask matching open players to return to those positions again.

After the import, the popup stays open, clears search, and shows the merged
list. You can still paste a YouTube link to open a video, or ordinary text to
search.

Waypoints checks the whole import before saving anything. If the JSON is
incomplete, unsupported, or contains invalid video data, your existing bookmarks
stay as they were. Be sure to copy all the JSON, including the outer braces.
The size limit is 5 million characters.

When macro names conflict, **Keep saved** keeps the local definitions and adds
new names, **Replace** uses the incoming definitions, and **Rename** keeps both
and updates references in the incoming macros. Identical definitions are
reused. Cancel stops the import before any write.

If the app saves the macros and then fails to save the bookmarks, it reports
the partial import. Paste the same JSON again and repeat the same conflict
choice to retry the bookmarks.

### If you're working with JSON yourself

The usual Waypoints export is the easiest format to use. The importer also
accepts a video map, an array of videos, or a storage snapshot with a `videos`
object. It ignores any `settings` in a snapshot. The JSON `version` describes
the transfer format, rather than the extension's version.

Versions 1 and 2, raw maps, and arrays remain readable. Version 3 carries
`tags` and an optional `macroLibrary`. Backups that use neither can still be
written in version 1 or 2. Waypoints also reads version 1 exports from its
private Alap editor. Older versions of the extension may reject version 3.

Supported bookmark fields include `id`, `title`, `t`, `duration`, `updated`,
`channelName`, `channelUrl`, `markers`, and `startNote`. Version 3 and the
private editor format also accept `tags`. Omitted tags preserve local tags.
An empty array clears tags. A supplied nonempty array replaces that video's
tag set. Version 3 and private editor imports reject unsupported fields.
The checks for supported fields include:

- Positions, durations, and timestamps must be nonnegative safe integers.
  Numeric strings, booleans, fractions, and `null` aren't accepted.
- Video IDs must be valid 11-character YouTube IDs. In a video map, each ID must
  match its key.
- Titles can be up to 1,000 characters, channel names 200, and channel URLs 2,048.
- Channel URLs must use HTTPS and a recognized YouTube channel path. Credentials,
  other hosts, control characters, and encoded path separators aren't accepted.

Text whitespace and control characters are normalized, and displayed text is
inserted as text rather than HTML. An invalid supported field stops the entire
import before anything is saved.

Copying happens only when you click **Copy JSON** or use a copy shortcut;
importing uses the text you paste. No additional clipboard permissions are
needed. For browser compatibility, copying can use a temporary offscreen text
selection, which is removed immediately afterward. If copying fails, the popup
shows an error; you don't need to edit JSON inside Settings.

## Concurrent saves and upgrade storage

You can have several bookmarked videos open at once. Each tab's progress saves
are recorded separately, so saving one video's position doesn't replace another
bookmark. Removing a bookmark also blocks an older save from bringing it back.
An import or a deliberate re-add lets that video be saved again.

Internally, Waypoints tracks versions of changes and bookmark lifetimes to keep
these actions in order. Those bookkeeping records aren't included in your JSON
backup.

### Updating or going back to an older version

When storage changes between versions, Waypoints reads older bookmarks and
saves them in the newer format before removing the old copies. Reload the
extension and existing YouTube tabs after upgrading so they all use the updated
code.

Before downgrading, make a backup with **Copy JSON**. Older builds can't read
the newer storage format.

Permanent deletion removes the bookmark's stored content from older journal
and recovery copies too. Only its identity and version remain, so a delayed
save can still be recognized and blocked.

### Checking information from the player

Before using a player's response, Waypoints checks that it came from the
expected video and frame, that times are valid and within bounds, and that
metadata uses the supported fields and YouTube channel URLs.

If an open player's response fails those checks, Waypoints shows an error and
leaves the bookmark unchanged. It only uses saved-position-only scrubbing when
there is no open tab for that video. The same checks apply when updating channel
details and autosaving. Transcript checks also cover video identity, timing,
size, and whether the complete response has arrived.

## Trash and permanent deletion

The default deletion mode gives you time to change your mind. Clicking **×** or
pressing **Delete** moves a bookmark to trash, where it stays for **7 days**
before permanent deletion.

To find it again, turn on **Show trash in the list and search** in Settings.
Your current bookmarks remain visible, and trash appears alongside them with a
red tint, a “Trash” label, and a **Restore** checkbox. Restore brings back the
saved position and channel details too. The header can also restore the most
recently trashed bookmark.

### Choosing when trash is removed

Set **Permanently delete trash after** to anywhere from 1–365 days. The setting
applies to existing trash as well, based on how long each bookmark has already
been there.

Cleanup runs when the popup opens, periodically while it's open, and while a
YouTube tab with the extension is active. If your browser or extension is
inactive when a bookmark's time runs out, removal waits for the next active
check.

**Empty trash** permanently removes everything in trash right away. Current
bookmarks stay in your list. Deleting an individual visible trash row also
removes it permanently.

### Choosing permanent deletion

If you prefer immediate removal, choose **Deletion mode → Permanent: delete
now**. This removes the bookmark's stored content as soon as you delete it,
with no Undo.

Playing a trashed video doesn't update its saved position or add it back to
your list. Opening the popup won't recreate a permanently deleted bookmark
either. Use **Restore bookmark**, **Add bookmark**, or import the video to bring
it back, as appropriate.

JSON backups include current bookmarks only, even while trash is visible.
Trash state and settings don't transfer. Importing a video that's in trash or
was previously deleted makes it a current bookmark again.

## Channel metadata

Channel names make it easier to find a video when you remember who made it but
not what it was called. Waypoints reads the channel name and URL from the
video's owner information on YouTube, using its existing permissions. No API
key or extra lookup request is needed.

New bookmarks include those details when available. Older bookmarks can pick
them up while their videos play or when you open the popup on those videos.
Opening the popup to add channel details keeps the bookmark's saved position
and update timestamp. If the details aren't available, any channel information
already saved stays in place.

In JSON, these details appear as `channelName` and `channelUrl`.

## Theme implementation

If you'd like to work on the appearance, start with
`src/shared/themes/light.css` and `dark.css` for colors. Shared typography and
dimensions live in `src/shared/styles/tokens.css`, while `popup.css` handles
component layout and interaction rules, with one declaration per line and no
hard-coded colors.

[THEMES.md](../THEMES.md) explains how the theme files fit together and walks
through adding a new theme.
