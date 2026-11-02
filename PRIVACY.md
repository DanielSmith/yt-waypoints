# YT Waypoints privacy policy

YT Waypoints stores YouTube bookmarks and playback positions locally in the
browser profile where the extension is installed. Records include the video
ID, title, saved time, duration, and an update timestamp. The channel name and
channel URL are also saved when available from the video page. Preferences are also
stored locally. Search text is used only to filter the list in the open panel.

The extension reads YouTube pages and controls video playback to provide its
bookmark, resume, and scrubbing features. Auto-bookmarking is enabled by default
when the panel is opened on an unsaved video and can be disabled in Options.
Only bookmarked videos have their progress tracked by the extension.

The extension does not send bookmarks, preferences, or search text to its
developer or any analytics service. It contains no telemetry, advertising,
account system, developer-operated server, or cloud synchronization.

Thumbnails are on by default and can be disabled in Options or with the t key.
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

You can explicitly export all saved videos as JSON from Options. Clicking Copy
JSON places video IDs, titles, playback positions, durations, timestamps, and
available channel metadata on your system clipboard. You can save that text or
paste it into another Waypoints installation to merge bookmarks. Preferences
are not included in the export and are not imported from pasted data. JSON
imports are processed locally; no import/export service or account is used.

Opening a bookmarked video navigates the browser to YouTube and includes the
video ID and saved playback time in the URL. YouTube's own privacy practices
apply to that website independently of this extension.

You can delete individual bookmarks using the × on each row. Bookmarks are
separate in each browser/profile and are not automatically shared between
Firefox, Chrome, and Brave.
