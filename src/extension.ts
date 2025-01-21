import * as vscode from 'vscode';

// Types
type DocumentInfo = {
  path: string;
  content: string;
};

// Pure functions
const shouldSkipFile = (path: string): boolean =>
  path.startsWith('git/') ||
  path.includes('.git') ||
  path.startsWith('.git');

const getDocumentInfo = (doc: vscode.TextDocument): DocumentInfo => ({
  path: vscode.workspace.asRelativePath(doc.uri),
  content: doc.getText()
});

const formatDocumentInfo = ({ path, content }: DocumentInfo): string => 
  `${path}:\n${content}\n\n`;

const createOutputDocument = async (content: string): Promise<void> => {
  const doc = await vscode.workspace.openTextDocument({ content });
  await vscode.window.showTextDocument(doc);
};

const listOpenFiles = async (): Promise<void> => {
  try {
    const allTabGroups = vscode.window.tabGroups.all;
    const openTabs = allTabGroups.flatMap(group => group.tabs);
    
    if (openTabs.length === 0) {
      vscode.window.showInformationMessage('No open files found.');
      return;
    }

    const seenFiles = new Set<string>();
    const documents = await Promise.all(
      openTabs
        .filter(tab => tab.input instanceof vscode.TabInputText)
        .map(async tab => {
          const uri = (tab.input as vscode.TabInputText).uri;
          return await vscode.workspace.openTextDocument(uri);
        })
    );
    
    const outputContent = documents
      .filter(doc => !doc.isUntitled)
      .filter(doc => {
        const path = vscode.workspace.asRelativePath(doc.uri);
        if (shouldSkipFile(path) || seenFiles.has(path)) {
          return false;
        }
        seenFiles.add(path);
        return doc.getText().trim().length > 0;
      })
      .map(getDocumentInfo)
      .map(formatDocumentInfo)
      .join('');

    await createOutputDocument(outputContent);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to list open files: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const activate = (context: vscode.ExtensionContext): void => {
  const disposable = vscode.commands.registerCommand(
    'list-open-files.listAllOpenFiles',
    listOpenFiles
  );

  context.subscriptions.push(disposable);
};

export const deactivate = (): void => {
  // Nothing to clean up
};
