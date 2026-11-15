# YT Waypoints privacy policy

YT Waypoints stores YouTube bookmarks and playback positions locally in the
browser profile where the extension is installed. Records include the video
ID, title, saved time, duration, and an update timestamp. The channel name and
channel URL are also saved when available from the video page. Preferences are also
stored locally. Search text is used only to filter the list in the open panel.

The extension reads YouTube pages and controls video playback to provide its
bookmark, resume, and scrubbing features. Auto-bookmarking is enabled by default
when the panel is opened on an unsaved video and can be disabled in Settings.
Only bookmarked videos have their progress tracked by the extension.

The extension does not send bookmarks, preferences, or search text to its
developer or any analytics service. It contains no telemetry, advertising,
account system, developer-operated server, or cloud synchronization.

Thumbnails are on by default and can be disabled in Settings or with the t key.
While enabled, the extension loads
images from YouTube's image service (`i.ytimg.com`) for displayed bookmarks.
These requests include the video IDs and expose your IP address and normal
network request metadata to that service. They do not send your saved playback
positions, video titles, channel names, search text, or preferences. Turning thumbnails off
stops the extension from creating thumbnail requests. The browser may cache
previously downloaded images.

Pasting a recognized YouTube video link into the popup opens that video using
a cleaned URL. Clipboard text is accessed only when you paste, and is not stored
as a search history or sent to the developer. Ordinary pasted search text is
used locally to filter the list.

You can explicitly export all saved videos as JSON from Settings. Clicking Copy
JSON places video IDs, titles, playback positions, durations, timestamps, and
available channel metadata on your system clipboard. You can save that text or
paste it into another Waypoints installation to merge bookmarks. Preferences
are not included in the export and are not imported from pasted data. JSON
imports are processed locally; no import/export service or account is used.

Pressing uppercase T on a selected bookmark reads that video's transcript from
an open YouTube tab and copies it to your system clipboard in your chosen format.
Settings also offers transcript copying and format explanations. Your format
preference and the shared offer to save to file preference are stored locally.
The save offer defaults off; when enabled it asks after a successful transcript
or all-bookmarks JSON copy whether you want a file too, then lets you choose its
filename. Declining does not change your clipboard copy. Transcript output can include the
video title, source URL, channel name, and timed segments. This may open
YouTube's transcript panel and requests YouTube's own structured transcript
through fixed same-origin YouTube endpoints, using the page's video-bound
transcript request and existing web-client context/session. The legacy layout
uses its selected-language token; modern panels use their native panel request.
No developer API key or
third-party transcript endpoint is used. Unverified partial data is not copied. The
extension holds prepared file content in memory while offering a save. It does
not save transcripts in extension storage or
send them to the developer or a third-party transcription service. Files you
explicitly save use your browser's download behavior. Waypoints does not guess
or translate the transcript language; modern panels do not supply a language label.

Opening a bookmarked video navigates the browser to YouTube and includes the
video ID and saved playback time in the URL. YouTube's own privacy practices
apply to that website independently of this extension.

You can delete individual bookmarks using the × on each row. The default
Timed mode moves a bookmark to browser-local trash, including its saved
position and metadata. Trash is hidden unless Show trash is enabled; it then
participates in local search and can be restored. Trash is excluded from JSON
exports. The retention time is stored locally and defaults to seven days.
Cleanup runs while the popup or a YouTube tab with the extension is active;
offline or inactive deadlines are handled at the next active check.

Permanent mode, deleting a trash row, Empty trash, or retention expiry removes
the row's stored content, including older migration/journal copies. Minimal
video identity and deletion/version records remain locally to prevent stale
saves from restoring it; there is no retained Undo copy of permanently deleted
row content. Bookmarks are separate in each browser/profile and are not
automatically shared between Firefox, Chrome, and Brave.
