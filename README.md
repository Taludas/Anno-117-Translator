# Anno 117 Translator

Translate Anno 117 mod localization files from English into all supported in-game languages using the DeepL API — directly inside Visual Studio Code.

## Features

- Translates all `<Text>` leaf nodes and raw `<ModOp>` text content in `texts_english.xml`
- Generates one output file per language in the same folder (`texts_german.xml`, `texts_french.xml`, …)
- Supported languages:
  - Brazilian Portuguese (PT-BR)
  - French (FR)
  - German (DE)
  - Italian (IT)
  - Japanese (JA)
  - Korean (KO)
  - Polish (PL)
  - Russian (RU)
  - Simplified Chinese (ZH-HANS)
  - Spanish (ES)
  - Traditional Chinese (ZH-HANT)
- All unique strings are collected and sent to DeepL in a single batch per language — fast and quota-efficient
- In-session translation cache avoids redundant API calls on repeated runs
- XML structure, whitespace, and indentation are preserved 1:1
- `<LineId>` numbers are never sent to DeepL
- Progress notifications while translating
- Hotkey support (default `Ctrl+Alt+T`)

## Requirements

- Visual Studio Code v1.80 or higher
- A DeepL API key (free tier is sufficient). Sign up at [deepl.com/pro#developer](https://www.deepl.com/pro#developer).

## Usage

1. Open `texts_english.xml` in the editor (it must be the active tab).
2. Press `Ctrl+Alt+T` or open the Command Palette (`Ctrl+Shift+P`) and run **Translate texts_english.xml**.
3. If no API key is saved in settings you will be prompted to enter it once.
4. Follow the prompts (see below) and watch the progress notification while the extension works.
5. The translated language files are written to the same folder as `texts_english.xml`.

### Overwrite prompts

When language files already exist, the extension asks two questions in sequence:

**Step 1 — Overwrite existing files?**

| Choice | Result |
|--------|--------|
| Yes | Existing files will be updated (see Step 2) |
| No | Existing files are left untouched; only missing language files are created |

**Step 2 — How to handle existing translations?** *(only shown when Step 1 = Yes)*

| Choice | Result |
|--------|--------|
| Re-translate all entries | Full retranslation of every entry in `texts_english.xml`; existing files are overwritten |
| Keep existing translations, only translate new entries | Existing translations are preserved; only entries whose `<LineId>` is absent from the language file are translated and appended |

The incremental mode ("only translate new entries") is the recommended choice when you add new text entries to an existing mod — it is faster, uses less DeepL quota, and leaves your previously reviewed translations intact.

> **Tip:** Pressing `Escape` on either prompt cancels the operation cleanly.

## Configuration

Open **Settings → Extensions → Anno 117 Translator Settings** to configure:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `anno117translator.deepLApiKey` | string | `""` | Your personal DeepL API key |
| `anno117translator.batchDelay` | number | `250` | Delay in ms after each DeepL request (increase if you hit rate limits) |
| `anno117translator.overwriteExisting` | boolean | `false` | Skip the overwrite prompt and always overwrite existing files (full retranslation) |

> **Tip:** `overwriteExisting: true` bypasses both prompts and retranslates everything. Use this for a clean rebuild of all language files.

## File format

The extension expects the standard Anno 117 mod localization format:

```xml
<ModOps>
    <ModOp Add="//TextExport/Texts">
        <Text>
            <LineId>1000001</LineId>
            <Text>English text to translate</Text>
        </Text>
    </ModOp>
</ModOps>
```

Each `<Text>` entry is identified by its `<LineId>`. The incremental translation mode uses `<LineId>` values to detect which entries are new. Entries without a `<LineId>` (raw `<ModOp>` text content) are identified by the `GUID` and `Path` attributes of their parent `<ModOp>`.

## License

[MIT](LICENSE) — free to use, modify, and distribute for personal or community projects.

## Release Notes

### 1.1.0

- **New:** Two-step overwrite prompt — first choose whether to overwrite existing files, then choose between a full retranslation and an incremental update (translate only new entries).
- **New:** Incremental translation mode — detects entries missing from an existing language file by `<LineId>`, translates only those, and inserts them at the correct position inside the file with matching indentation.
- **Fixed:** `<LineId>` numbers were incorrectly sent to DeepL for translation.
- **Fixed:** Whitespace and indentation in raw `<ModOp>` text blocks are now preserved exactly as in the source file.
- **Fixed:** All text strings are now collected in a single DeepL batch per language instead of one API call per `<Text>` block, significantly reducing translation time and API usage.
- **Fixed:** Pressing `Escape` on any prompt now cancels the operation cleanly.

### 1.0.0

Initial release.
