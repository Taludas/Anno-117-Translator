# anno117-translator README

Translate Anno 117 XML files from English into all supported game languages using DeepL directly in Visual Studio Code.

This extension provides fast, batch translations, supports hotkeys, progress notifications, and lets you overwrite existing language files with a single prompt.

## Features

- Translate all <Text> nodes and raw <ModOp> text in texts_english.xml
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

- Batch translation with caching for maximum speed
- Progress bar showing per-language and per-string translation
- User-configurable DeepL API key
- Configurable batch delay to avoid rate limits
- Single prompt for overwriting existing language files
- Hotkey support (default Ctrl+Alt+T)

## Requirements

- Visual Studio Code v1.80 or higher
- Node.js v16 or higher
- DeepL API key – free account. You can get one [here](https://www.deepl.com/pro#developer).

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Configuration
Open Settings → Extensions → Anno 117 Translator to configure:

| Setting                               | Type    | Default | Description                                                       |
| ------------------------------------- | ------- | ------- | ----------------------------------------------------------------- |
| `anno117translator.deepLApiKey`       | string  | `""`    | Insert your personal DeepL API key                                |
| `anno117translator.batchDelay`        | number  | `250`   | Delay per batch in milliseconds (avoid rate limits)               |
| `anno117translator.overwriteExisting` | boolean | `false` | Automatically overwrite existing language files without prompting |

> Tip: If no API key is set, the extension will prompt you to enter it the first time you run a translation.

## Usage
1. Open your texts_english.xml in VS Code.
2. Press your hotkey (default: Ctrl+Alt+T) or run the command from the Command Palette: "Anno 117: Translate texts_english.xml".
3. If some language files already exist, you will be prompted once to overwrite them.
4. The extension will show a progress bar while translating.
5. Upon completion, new language files will be generated in the same folder.

## Notes
- The extension uses DeepL API in batch mode.
- Strings already translated are cached to avoid duplicate requests.
- Nodes inside <Text> containers and raw <ModOp> text are translated.
- XML structure and formatting are preserved.

## License
MIT License – feel free to modify and use for personal or community projects.

## Known Issues

## Release Notes

### 1.0.0

Initial release
