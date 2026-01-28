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

      // Single prompt for overwriting existing files
      let overwriteAll = overwriteSetting;
      if (existingFiles.length > 0 && !overwriteAll) {
        const choice = await vscode.window.showQuickPick(
          ["Yes", "No"],
          {
            placeHolder: "Some language files already exist. Overwrite all existing language files?"
          }
        );
        overwriteAll = choice === "Yes";
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
              increment: (langCounter / totalLanguages) * 100 
            });

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

            const newFilePath = path.join(dir, `texts_${langName}.xml`);

            // Write file with overwrite check
            if (fs.existsSync(newFilePath)) {
              if (overwriteAll) {
                fs.writeFileSync(newFilePath, translatedXml, "utf8");
              } else {
                vscode.window.showInformationMessage(`Skipped ${path.basename(newFilePath)}`);
                langCounter++;
                continue;
              }
            } else {
              fs.writeFileSync(newFilePath, translatedXml, "utf8");
            }

            langCounter++;
            progress.report({ increment: (langCounter / totalLanguages) * 100 });
          }
        }
      );

      vscode.window.showInformationMessage("Anno 117 translations completed successfully!");
    }
  );

  context.subscriptions.push(disposable);
}

//
// PASS 1: translate <Text> nodes
//
async function translateAllTextNodes(
  xml: string,
  targetLang: string,
  apiKey: string,
  batchDelay: number,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string> {
  const regex = /<Text>([\s\S]*?)<\/Text>/g;
  let match;
  let resultXml = xml;

  while ((match = regex.exec(xml)) !== null) {
    const inner = match[1];

    const textNodes = inner
      .split(/(<[^>]+>)/g)
      .filter(part => !part.startsWith("<"))
      .map(t => t.trim())
      .filter(Boolean);

    if (textNodes.length === 0) continue;

    const translations = await translateBatch(textNodes, targetLang, apiKey, batchDelay);

    let newInner = inner;
    for (let i = 0; i < textNodes.length; i++) {
      const text = textNodes[i];
      const translated = translations.get(text) ?? translationCache.get(`${targetLang}:${text}`);
      if (translated) newInner = newInner.replace(text, translated);

      if (progress) {
        progress.report({ message: `Translating ${text} (${i + 1}/${textNodes.length}) in ${targetLang}` });
      }
    }

    const originalBlock = match[0];
    const translatedBlock = `<Text>${newInner}</Text>`;
    resultXml = resultXml.replace(originalBlock, translatedBlock);
  }

  return resultXml;
}

//
// PASS 2: translate raw <ModOp> text
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
  let resultXml = xml;

  while ((match = modOpRegex.exec(xml)) !== null) {
    const inner = match[1];
    if (inner.includes("<")) continue;

    const text = inner.trim();
    if (!text) continue;

    let translated = translationCache.get(`${targetLang}:${text}`);
    if (!translated) {
      const batch = await translateBatch([text], targetLang, apiKey, batchDelay);
      translated = batch.get(text);
    }

    if (translated) {
      const originalBlock = match[0];
      const translatedBlock = originalBlock.replace(inner, `\n${translated}\n`);
      resultXml = resultXml.replace(originalBlock, translatedBlock);
    }

    if (progress) {
      progress.report({ message: `Translating ModOp text in ${targetLang}` });
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