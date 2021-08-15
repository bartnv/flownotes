# FlowNotes

FlowNotes is a web-based tool for fluid personal note-taking. It allows you to
forget about organisation, layout and even saving, to keep you in the flow of
writing your thoughts down.

## Features
* Web-based for easy access from any device
* Flat text notes for maximum compatibility
* Github-style Markdown markup if you need a bit of styling
* View mode to see the rendered layout with clickable links
* Stored in a single industry-standard SQLite database file
* Full-text search to find any note you're looking for
* Pinned notes to keep those important ones always within reach

More info is available at [FlowNotes.org](https://flownotes.org)

## Requirements

Web-hosting with PHP 7.0+ and the PHP sqlite3 package installed.
Browser with ECMAScript 6 support (Chrome 49+, Firefox 44+, Safari 10+, Edge 14+).

## Release policy

I do my best to keep the master branch always deployable. As such there is no
point in tagging patch-level releases. If you want to stay at the bleeding edge,
just update from git. Periodically I will cut a feature release as a minor
version. Releases that drop support for older browsers or PHP versions will be
published with a new major version. Other than that, I maintain full backward
compatibility. Any feature release may upgrade your database schema, however, so
keep this in mind if you move databases between installs.
