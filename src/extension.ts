import * as vscode from 'vscode';

// Git API types
interface GitExtension {
  getAPI(version: number): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
}

interface Repository {
  state: RepositoryState;
}

interface RepositoryState {
  indexChanges: GitChange[];
  workingTreeChanges: GitChange[];
  untrackedChanges: GitChange[];
}

interface GitChange {
  uri: vscode.Uri;
  originalUri?: vscode.Uri;
  renameUri?: vscode.Uri;
}

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

interface FilePickItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
}

const listModifiedFiles = async (): Promise<void> => {
  try {
    // Get Git extension
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
      vscode.window.showErrorMessage('Git extension not found or not activated.');
      return;
    }

    // Get Git API and repository
    const git = (gitExtension as GitExtension).getAPI(1);
    const repositories = git.repositories;
    
    if (repositories.length === 0) {
      vscode.window.showInformationMessage('No Git repositories found in workspace.');
      return;
    }

    // Collect all modified files from all repositories
    const modifiedFiles: FilePickItem[] = [];
    
    for (const repo of repositories) {
      const state = repo.state;
      
      // Combine all changes (staged, working tree, etc.)
      const changes = [
        ...state.indexChanges,
        ...state.workingTreeChanges,
        ...state.untrackedChanges
      ];
      
      if (changes.length === 0) {
        continue;
      }
      
      // Add each changed file to the list
      for (const change of changes) {
        try {
          const uri = change.uri;
          const relativePath = vscode.workspace.asRelativePath(uri);
          
          if (!shouldSkipFile(relativePath)) {
            modifiedFiles.push({
              label: relativePath,
              picked: true, // Selected by default
              uri: uri
            });
          }
        } catch (err) {
          // Skip files that can't be processed
          continue;
        }
      }
    }
    
    if (modifiedFiles.length === 0) {
      vscode.window.showInformationMessage('No modified files found.');
      return;
    }

    // Show QuickPick UI with checkboxes
    const selectedFiles = await vscode.window.showQuickPick(modifiedFiles, {
      canPickMany: true,
      placeHolder: 'Select files to include in the output',
      title: 'Modified Files'
    });
    
    // User cancelled the selection
    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }
    
    // Process selected files
    let outputContent = '';
    for (const file of selectedFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file.uri);
        const info = getDocumentInfo(doc);
        outputContent += formatDocumentInfo(info);
      } catch (err) {
        // Skip files that can't be opened
        continue;
      }
    }
    
    await createOutputDocument(outputContent);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to list modified files: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const activate = (context: vscode.ExtensionContext): void => {
  // Register the original command
  const listOpenFilesCommand = vscode.commands.registerCommand(
    'list-open-files.listAllOpenFiles',
    listOpenFiles
  );
  
  // Register the new command for modified files
  const listModifiedFilesCommand = vscode.commands.registerCommand(
    'list-open-files.listModifiedFiles',
    listModifiedFiles
  );

  context.subscriptions.push(listOpenFilesCommand, listModifiedFilesCommand);
};

export const deactivate = (): void => {
  // Nothing to clean up
};
