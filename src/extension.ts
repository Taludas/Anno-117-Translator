import * as vscode from "vscode";
import axios from "axios";
import * as path from "path";
import * as fs from "fs";

// DeepL endpoint
const DEEPL_ENDPOINT = "https://api-free.deepl.com/v2/translate";

// Languages for Anno 117
const LANGUAGES: Record<string, string> = {
  brazilian: "PT-BR",
  french: "FR",
  german: "DE",
  italian: "IT",
  japanese: "JA",
  korean: "KO",
  polish: "PL",
  russian: "RU",
  simplified_chinese: "ZH-HANS",
  spanish: "ES",
  traditional_chinese: "ZH-HANT"
};

// Translation cache
const translationCache = new Map<string, string>();

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "anno117.translateXml",
    async () => {
      const config = vscode.workspace.getConfiguration("anno117translator");
      const BATCH_DELAY: number = config.get("batchDelay") ?? 250;
      let DEEPL_API_KEY: string | undefined = config.get("deepLApiKey");
      const overwriteSetting: boolean = config.get("overwriteExisting") ?? false;

      // Prompt for API key if missing
      if (!DEEPL_API_KEY) {
        DEEPL_API_KEY = await vscode.window.showInputBox({
          placeHolder: "Enter your personal DeepL API key",
          ignoreFocusOut: true,
          password: true
        });
        if (!DEEPL_API_KEY) {
          vscode.window.showErrorMessage(
            "DeepL API key is required to run the translation."
          );
          return;
        }
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No file open.");
        return;
      }

      const document = editor.document;
      if (!document.fileName.endsWith("texts_english.xml")) {
        vscode.window.showErrorMessage(
          "Please open texts_english.xml before running this command."
        );
        return;
      }

      const originalXml = document.getText();
      const dir = path.dirname(document.fileName);

      // Determine existing language files
      const existingFiles: string[] = [];
      for (const langName of Object.keys(LANGUAGES)) {
        const filePath = path.join(dir, `texts_${langName}.xml`);
        if (fs.existsSync(filePath)) existingFiles.push(filePath);
      }

      // Step 1: prompt whether to overwrite existing files
      let overwriteAll = overwriteSetting;
      let retranslateExisting = true;

      if (existingFiles.length > 0 && !overwriteAll) {
        const overwriteChoice = await vscode.window.showQuickPick(
          ["Yes", "No"],
          {
            placeHolder: "Some language files already exist. Overwrite existing language files?"
          }
        );
        if (overwriteChoice === undefined) return; // cancelled
        overwriteAll = overwriteChoice === "Yes";

        // Step 2: if overwriting, ask whether to redo all translations or only new entries
        if (overwriteAll) {
          const modeChoice = await vscode.window.showQuickPick(
            ["Re-translate all entries", "Keep existing translations, only translate new entries"],
            {
              placeHolder: "How should existing translations be handled?"
            }
          );
          if (modeChoice === undefined) return; // cancelled
          retranslateExisting = modeChoice === "Re-translate all entries";
        }
      }

      // Show progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Translating Anno 117 XML...",
          cancellable: false
        },
        async (progress) => {
          const totalLanguages = Object.keys(LANGUAGES).length;
          let langCounter = 0;

          for (const [langName, langCode] of Object.entries(LANGUAGES)) {
            progress.report({
              message: `Translating ${langName}...`,
              increment: (1 / totalLanguages) * 100
            });

            const newFilePath = path.join(dir, `texts_${langName}.xml`);
            const fileExists = fs.existsSync(newFilePath);

            if (fileExists && !overwriteAll) {
              vscode.window.showInformationMessage(`Skipped ${path.basename(newFilePath)}`);
              langCounter++;
              continue;
            }

            if (fileExists && overwriteAll && !retranslateExisting) {
              // Incremental mode: only translate entries missing from the existing file
              const existingContent = fs.readFileSync(newFilePath, "utf8");
              const mergedXml = await mergeWithNewTranslations(
                originalXml,
                existingContent,
                langCode,
                DEEPL_API_KEY,
                BATCH_DELAY,
                progress
              );
              fs.writeFileSync(newFilePath, mergedXml, "utf8");
            } else {
              // Full translation mode: translate the entire English source
              let translatedXml = originalXml;

              // PASS 1: translate <Text> nodes
              translatedXml = await translateAllTextNodes(
                translatedXml,
                langCode,
                DEEPL_API_KEY,
                BATCH_DELAY,
                progress
              );

              // PASS 2: translate raw <ModOp> text
              translatedXml = await translateRawModOpText(
                translatedXml,
                langCode,
                DEEPL_API_KEY,
                BATCH_DELAY,
                progress
              );

              fs.writeFileSync(newFilePath, translatedXml, "utf8");
            }

            langCounter++;
          }
        }
      );

      vscode.window.showInformationMessage("Anno 117 translations completed successfully!");
    }
  );

  context.subscriptions.push(disposable);
}

//
// Incremental translation: translate only entries absent from the existing language file.
//
// Two complementary checks run in parallel:
//   1. <Text>/<LineId> comparison — the primary case: new text entries added inside an
//      existing <ModOp>. Each entry is identified by its <LineId> number. New entries
//      are inserted before the first </ModOp> closing tag in the language file.
//   2. <ModOp> GUID+Path comparison — the secondary case: entirely new <ModOp> blocks
//      (e.g. a new building added to the mod). New blocks are inserted before the root
//      closing tag.
//
async function mergeWithNewTranslations(
  englishXml: string,
  existingLangXml: string,
  langCode: string,
  apiKey: string,
  batchDelay: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string> {
  const existingLineIds = extractLineIds(existingLangXml);
  const existingModOpKeys = extractModOpKeys(existingLangXml);

  const newTextEntries = extractMissingTextEntries(englishXml, existingLineIds);
  const newModOpBlocks = extractMissingModOpBlocks(englishXml, existingModOpKeys);

  const totalNew = newTextEntries.length + newModOpBlocks.length;
  if (totalNew === 0) {
    return existingLangXml;
  }

  progress.report({ message: `Found ${totalNew} new entries to translate...` });

  let result = existingLangXml;

  // Case 1: new <Text> entries with new <LineId>s — insert inside the existing ModOp
  if (newTextEntries.length > 0) {
    const tempXml = newTextEntries.join("\n");
    const translatedEntries = await translateAllTextNodes(tempXml, langCode, apiKey, batchDelay, progress);

    // Find the newline that immediately precedes the first </ModOp> and insert before it,
    // so the new blocks sit at the same indentation level as the existing entries.
    const firstModOpClose = /\n\s*<\/ModOp>/.exec(result);
    if (firstModOpClose) {
      result =
        result.slice(0, firstModOpClose.index) +
        "\n" + translatedEntries +
        result.slice(firstModOpClose.index);
    } else {
      result = insertBeforeRootClose(result, translatedEntries);
    }
  }

  // Case 2: completely new <ModOp> blocks — insert before the root closing tag
  if (newModOpBlocks.length > 0) {
    const tempXml = newModOpBlocks.join("\n");
    let translatedModOps = await translateAllTextNodes(tempXml, langCode, apiKey, batchDelay, progress);
    translatedModOps = await translateRawModOpText(translatedModOps, langCode, apiKey, batchDelay, progress);
    result = insertBeforeRootClose(result, translatedModOps);
  }

  return result;
}

// Returns all <LineId> numbers found in the given XML.
function extractLineIds(xml: string): Set<string> {
  const lineIdRegex = /<LineId>(\d+)<\/LineId>/g;
  const ids = new Set<string>();
  let match;
  while ((match = lineIdRegex.exec(xml)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

// Returns outer <Text> blocks (those wrapping a <LineId> + leaf <Text>) whose
// LineId is not present in existingLineIds.
// The regex explicitly encodes the known Anno loca structure so the nested </Text>
// tags are handled correctly without a general XML parser.
function extractMissingTextEntries(englishXml: string, existingLineIds: Set<string>): string[] {
  const textEntryRegex = /[ \t]*<Text>\s*<LineId>(\d+)<\/LineId>\s*<Text>[^<]*<\/Text>\s*<\/Text>/g;
  const blocks: string[] = [];
  let match;
  while ((match = textEntryRegex.exec(englishXml)) !== null) {
    if (!existingLineIds.has(match[1])) {
      blocks.push(match[0]);
    }
  }
  return blocks;
}

// Returns a set of "GUID|Path" composite keys for all <ModOp> tags in the given XML.
function extractModOpKeys(xml: string): Set<string> {
  const modOpTagRegex = /<ModOp\b([^>]*)>/g;
  const keys = new Set<string>();
  let match;
  while ((match = modOpTagRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const guidMatch = attrs.match(/GUID="([^"]+)"/);
    const pathMatch = attrs.match(/Path="([^"]+)"/);
    if (guidMatch) {
      keys.add(guidMatch[1] + (pathMatch ? `|${pathMatch[1]}` : ""));
    }
  }
  return keys;
}

// Returns ModOp blocks from englishXml whose GUID+Path key is not in existingKeys.
function extractMissingModOpBlocks(englishXml: string, existingKeys: Set<string>): string[] {
  const modOpBlockRegex = /<ModOp\b[^>]*>[\s\S]*?<\/ModOp>/g;
  const blocks: string[] = [];
  let match;
  while ((match = modOpBlockRegex.exec(englishXml)) !== null) {
    const block = match[0];
    const tagMatch = block.match(/<ModOp\b([^>]*)>/);
    if (!tagMatch) continue;
    const attrs = tagMatch[1];
    const guidMatch = attrs.match(/GUID="([^"]+)"/);
    const pathMatch = attrs.match(/Path="([^"]+)"/);
    if (guidMatch) {
      const key = guidMatch[1] + (pathMatch ? `|${pathMatch[1]}` : "");
      if (!existingKeys.has(key)) {
        blocks.push(block);
      }
    }
  }
  return blocks;
}

// Inserts content before the last closing root element tag of the given XML.
function insertBeforeRootClose(xml: string, content: string): string {
  const closingTagMatch = xml.match(/<\/([A-Za-z_][A-Za-z0-9_]*)>\s*$/);
  if (closingTagMatch) {
    const closingTag = `</${closingTagMatch[1]}>`;
    const insertIdx = xml.lastIndexOf(closingTag);
    return (
      xml.slice(0, insertIdx).trimEnd() +
      "\n" + content.trim() + "\n" +
      xml.slice(insertIdx)
    );
  }
  return xml + "\n" + content;
}

//
// PASS 1: translate <Text> leaf nodes (no child elements)
//
// Uses [^<]+ instead of [\s\S]*? so that only leaf <Text> elements are matched.
// This prevents outer <Text> blocks (which contain <LineId> and nested <Text>)
// from being captured — [^<]+ stops at any '<', so only tag-free content matches.
// All unique text nodes are collected first and sent in a single DeepL batch per
// language, then applied from the cache, avoiding one API call per <Text> block.
//
async function translateAllTextNodes(
  xml: string,
  targetLang: string,
  apiKey: string,
  batchDelay: number,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string> {
  const regex = /<Text>([^<]+)<\/Text>/g;
  let match;

  type Replacement = { original: string; inner: string; textNodes: string[] };
  const pending: Replacement[] = [];
  const allTexts = new Set<string>();

  while ((match = regex.exec(xml)) !== null) {
    const inner = match[1];
    const textNodes = inner
      .split(/(<[^>]+>)/g)
      .filter(part => !part.startsWith("<"))
      .map(t => t.trim())
      .filter(t => Boolean(t) && !/^\d+$/.test(t)); // skip empty strings and bare numbers

    if (textNodes.length === 0) continue;
    pending.push({ original: match[0], inner, textNodes });
    textNodes.forEach(t => allTexts.add(t));
  }

  if (allTexts.size === 0) return xml;

  if (progress) {
    progress.report({ message: `Sending ${allTexts.size} text entries to DeepL for ${targetLang}...` });
  }

  // Single batch for all unique texts in this language
  await translateBatch([...allTexts], targetLang, apiKey, batchDelay);

  // Apply replacements from the cache, preserving original whitespace around text
  let resultXml = xml;
  for (const { original, inner, textNodes } of pending) {
    let newInner = inner;
    for (const text of textNodes) {
      const translated = translationCache.get(`${targetLang}:${text}`);
      if (translated) newInner = newInner.replace(text, translated);
    }
    resultXml = resultXml.replace(original, `<Text>${newInner}</Text>`);
  }

  return resultXml;
}

//
// PASS 2: translate raw <ModOp> text (no child elements)
//
// All unique raw texts are collected first and sent in a single batch, then
// applied from the cache. The replacement targets only the trimmed text so that
// the original surrounding whitespace (indentation) is preserved 1:1.
//
async function translateRawModOpText(
  xml: string,
  targetLang: string,
  apiKey: string,
  batchDelay: number,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string> {
  const modOpRegex = /<ModOp[^>]*>([\s\S]*?)<\/ModOp>/g;
  let match;

  type Replacement = { original: string; text: string };
  const pending: Replacement[] = [];
  const allTexts = new Set<string>();

  while ((match = modOpRegex.exec(xml)) !== null) {
    const inner = match[1];
    if (inner.includes("<")) continue; // has child elements — handled by PASS 1

    const text = inner.trim();
    if (!text || /^\d+$/.test(text)) continue; // skip empty and bare numbers

    pending.push({ original: match[0], text });
    allTexts.add(text);
  }

  if (allTexts.size === 0) return xml;

  if (progress) {
    progress.report({ message: `Sending ${allTexts.size} ModOp entries to DeepL for ${targetLang}...` });
  }

  await translateBatch([...allTexts], targetLang, apiKey, batchDelay);

  let resultXml = xml;
  for (const { original, text } of pending) {
    const translated = translationCache.get(`${targetLang}:${text}`);
    if (translated) {
      // Replace the trimmed text within the original block, leaving surrounding
      // whitespace (newlines, indentation) exactly as in the source file
      resultXml = resultXml.replace(original, original.replace(text, translated));
    }
  }

  return resultXml;
}

//
// Batch translation helper
//
async function translateBatch(
  texts: string[],
  targetLang: string,
  apiKey: string,
  batchDelay: number
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const toTranslate = texts.filter(
    t => !translationCache.has(`${targetLang}:${t}`)
  );
  if (toTranslate.length === 0) return result;

  const params = new URLSearchParams();
  for (const text of toTranslate) {
    params.append("text", text);
  }
  params.append("source_lang", "EN");
  params.append("target_lang", targetLang);
  params.append("preserve_formatting", "1");

  const response = await axios.post(
    DEEPL_ENDPOINT,
    params.toString(),
    {
      headers: {
        "Authorization": `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  response.data.translations.forEach((t: { text: string }, i: number) => {
    const original = toTranslate[i];
    const translated = t.text;
    translationCache.set(`${targetLang}:${original}`, translated);
    result.set(original, translated);
  });

  await delay(batchDelay);
  return result;
}

//
// Helper delay
//
function delay(ms = 400) {
  return new Promise(res => setTimeout(res, ms));
}

export function deactivate() {}