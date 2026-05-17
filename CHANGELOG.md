# Change Log

All notable changes to the "anno117-xml-translator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.0] - 2026-05-17

### Changed
- Reworked overwrite prompt into a two-step flow: first ask whether to overwrite existing language files, then (if yes) ask whether to re-translate all entries or keep existing translations and only translate entries that are new in `texts_english.xml` and missing from the other loca files.
- Incremental translation mode now correctly handles the standard Anno loca file structure (one `<ModOp>` containing all `<Text>` entries). New entries are identified by their `<LineId>` value and inserted before the first `</ModOp>` closing tag, matching the indentation of surrounding entries. Completely new `<ModOp>` blocks (secondary case) are still detected by `GUID`+`Path` and inserted before the root closing tag.
- Cancelling either prompt now aborts the command gracefully instead of proceeding with default values.
- Progress reporting now increments correctly per language processed.

### Fixed
- **LineId no longer sent to DeepL:** The `<Text>` regex was changed from `[\s\S]*?` (greedy-across-tags) to `[^<]+` (leaf-only). Previously, the outer `<Text>` block containing `<LineId>` and a nested `<Text>` would match from the outer open tag to the inner close tag, causing the LineId number and partially malformed XML to be included in the translation payload.
- **Formatting preserved 1:1 in raw ModOp text (PASS 2):** The replacement now targets only the trimmed text content, leaving the original surrounding whitespace (newlines, indentation) untouched. Previously it was replaced with a hardcoded `\n...\n` with no indentation.
- **Batching corrected:** All unique text nodes are now collected from the entire document first and sent in a single DeepL request per language, instead of one API call per `<Text>` block. This matches how the DeepL API is intended to be used (multi-text batches) and drastically reduces both API call count and total delay time (e.g. 50 entries: was ~50 calls × 250 ms = 12.5 s delay per language; now 1 call × 250 ms = 0.25 s).

## [1.0.0]

- Initial release