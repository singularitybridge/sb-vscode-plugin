import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';

// Promisify exec for async/await usage
const execPromise = util.promisify(cp.exec);

// Git API types
interface GitExtension {
  getAPI(version: number): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
}

interface Repository {
  state: RepositoryState;
  // Additional properties for branch comparison
  getBranches(options?: { remote?: boolean }): Promise<Branch[]>;
  getBranchLocal(name: string): Branch | undefined;
  diff(ref1: string, ref2: string, options?: { detect?: boolean }): Promise<string>;
  show(ref: string, path: string): Promise<string>;
  // Execute git command
  exec(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

interface Branch {
  name: string;
  upstream?: { name: string };
  commit: string;
  remote: boolean;
}

interface RepositoryState {
  HEAD: Branch | undefined;
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

// Function to list files that differ between current branch and main/master
const listBranchComparisonFiles = async (): Promise<void> => {
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

    // Use the first repository (most VS Code workspaces have one repository)
    const repo = repositories[0];
    
    // Try to get current branch using multiple methods
    let currentBranch = repo.state.HEAD;
    
    // Debug info
    console.log('Repository state:', repo.state ? 'exists' : 'undefined');
    console.log('HEAD:', currentBranch ? `Branch: ${currentBranch.name}` : 'undefined');
    
    // If HEAD is undefined or HEAD.name is empty, try alternative methods
    if (!currentBranch || !currentBranch.name) {
      try {
        // Method 1: Try to execute git command to get current branch
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (workspaceFolder && repo.exec) {
          try {
            // Execute 'git branch --show-current' to get current branch name
            const result = await repo.exec(workspaceFolder, ['branch', '--show-current']);
            const branchName = result.stdout.trim();
            
            console.log('Git command result - branch name:', branchName);
            
            if (branchName) {
              // Create a Branch object with the name we got
              currentBranch = {
                name: branchName,
                commit: '', // We don't have this info, but it's not used later
                remote: false
              };
              console.log('Created branch object:', currentBranch);
            }
          } catch (execErr) {
            console.error('Error executing git command:', execErr);
          }
        }
        
        // Method 2: Try to get branch name from Git configuration
        if (!currentBranch && workspaceFolder && repo.exec) {
          try {
            // Try to get the branch from Git config
            const result = await repo.exec(workspaceFolder, ['symbolic-ref', '--short', 'HEAD']);
            const branchName = result.stdout.trim();
            
            console.log('Git symbolic-ref result - branch name:', branchName);
            
            if (branchName) {
              // Create a Branch object with the name we got
              currentBranch = {
                name: branchName,
                commit: '',
                remote: false
              };
              console.log('Created branch object from symbolic-ref:', currentBranch);
            }
          } catch (execErr) {
            console.error('Error executing git symbolic-ref command:', execErr);
          }
        }
        
        // Method 3: Ask the user for the branch name
        if (!currentBranch) {
          try {
            const branchName = await vscode.window.showInputBox({
              prompt: 'Unable to determine current branch automatically. Please enter your current branch name:',
              placeHolder: 'e.g., main, feature/my-branch'
            });
            
            if (branchName) {
              currentBranch = {
                name: branchName,
                commit: '',
                remote: false
              };
              console.log('Using user-provided branch name:', branchName);
            } else {
              // User cancelled input
              vscode.window.showErrorMessage('Branch comparison cancelled. No branch name provided.');
              return;
            }
          } catch (inputErr) {
            console.error('Error getting branch name from user:', inputErr);
          }
        }
        
        // If we still don't have a branch after all attempts
        if (!currentBranch) {
          // Try to get all local branches to see if we can find the current one
          const branches = await repo.getBranches({ remote: false });
          console.log('Available branches:', branches.map(b => b.name).join(', '));
          
          // Check if we're in a Git repository
          if (repo.state) {
            vscode.window.showErrorMessage('Unable to determine current branch. You might be in a detached HEAD state or the repository might not have any commits yet.');
          } else {
            vscode.window.showErrorMessage('Unable to determine current branch. Please ensure you are in a Git repository with at least one commit.');
          }
          return;
        }
      } catch (err) {
        console.error('Error getting branches:', err);
        vscode.window.showErrorMessage('Unable to determine current branch. Error getting branch information.');
        return;
      }
    }

    // Get all local branches
    const branches = await repo.getBranches({ remote: false });
    
    // Find main or master branch (local first)
    let mainBranch = branches.find(branch => 
      branch.name === 'main' || branch.name === 'master'
    );
    
    // If not found locally, try to get all branches including remote ones
    if (!mainBranch) {
      console.log('No local main/master branch found. Checking remote branches...');
      const allBranches = await repo.getBranches({ remote: true });
      console.log('Available branches (including remote):', allBranches.map(b => b.name).join(', '));
      
      mainBranch = allBranches.find(branch => 
        branch.name === 'main' || 
        branch.name === 'master' || 
        branch.name === 'origin/main' || 
        branch.name === 'origin/master'
      );
      
      if (mainBranch) {
        console.log(`Found remote branch: ${mainBranch.name}`);
      }
    }
    
    if (!mainBranch) {
      vscode.window.showErrorMessage('No main or master branch found in the repository (checked both local and remote).');
      return;
    }

    // Get the comparison base branch name
    const baseBranchName = mainBranch.name;
    
    console.log(`Comparing branches: ${baseBranchName} and ${currentBranch.name}`);
    
    // Try multiple approaches to get changed files
    const changedFilePaths = new Set<string>();
    
    // Approach 1: Use Node.js child_process to directly execute git command
    // This bypasses the VS Code Git API completely
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (workspaceFolder) {
        // Execute the exact command that works in the terminal using Node.js child_process
        const command = `git -C "${workspaceFolder}" diff --name-only ${baseBranchName}...${currentBranch.name}`;
        console.log(`Executing direct command: ${command}`);
        
        const { stdout, stderr } = await execPromise(command);
        
        console.log('Direct git command output:', stdout);
        console.log('Direct git command error:', stderr);
        
        const fileList = stdout.trim().split('\n').filter(line => line.trim() !== '');
        console.log('Files from direct git command:', fileList);
        
        // Add files from direct command
        for (const file of fileList) {
          if (!shouldSkipFile(file)) {
            changedFilePaths.add(file);
          }
        }
        
        // If no files found, try with two dots
        if (changedFilePaths.size === 0) {
          const twoDotsCommand = `git -C "${workspaceFolder}" diff --name-only ${baseBranchName}..${currentBranch.name}`;
          console.log(`Executing direct command with two dots: ${twoDotsCommand}`);
          
          const twoDotsResult = await execPromise(twoDotsCommand);
          
          console.log('Direct git command output (two dots):', twoDotsResult.stdout);
          
          const twoDotsFileList = twoDotsResult.stdout.trim().split('\n').filter(line => line.trim() !== '');
          console.log('Files from direct git command (two dots):', twoDotsFileList);
          
          // Add files from two dots command
          for (const file of twoDotsFileList) {
            if (!shouldSkipFile(file)) {
              changedFilePaths.add(file);
            }
          }
        }
      }
    } catch (directExecErr) {
      console.error('Error executing direct git command:', directExecErr);
    }
    
    // Approach 2: Try using repo.exec if direct command failed
    if (changedFilePaths.size === 0) {
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (workspaceFolder && repo.exec) {
          console.log(`Executing git diff --name-only ${baseBranchName}...${currentBranch.name} via repo.exec`);
          
          const result = await repo.exec(workspaceFolder, [
            'diff', '--name-only', `${baseBranchName}...${currentBranch.name}`
          ]);
          
          console.log('Git diff command output via repo.exec:', result.stdout);
          console.log('Git diff command error via repo.exec:', result.stderr);
          
          const fileList = result.stdout.trim().split('\n').filter(line => line.trim() !== '');
          console.log('Files from git diff command via repo.exec:', fileList);
          
          for (const file of fileList) {
            if (!shouldSkipFile(file)) {
              changedFilePaths.add(file);
            }
          }
        }
      } catch (diffErr) {
        console.error('Error executing git diff command via repo.exec:', diffErr);
      }
    }
    
    // Approach 2: Use repo.diff method (less reliable due to VS Code Git API limitations)
    // The VS Code Git API uses triple-dot (...) comparison which only shows changes introduced on the second branch
    if (changedFilePaths.size === 0) {
      try {
        const diffOutput = await repo.diff(baseBranchName, currentBranch.name, { detect: true });
        console.log('Diff output from repo.diff:', diffOutput);
        
        const diffLines = diffOutput.split('\n');
        for (const line of diffLines) {
          if (line.startsWith('diff --git')) {
            const match = line.match(/diff --git a\/(.*) b\/(.*)/);
            if (match && match[1]) {
              changedFilePaths.add(match[1]);
            }
          }
        }
        
        console.log('Files found from repo.diff:', Array.from(changedFilePaths));
      } catch (diffErr) {
        console.error('Error using repo.diff:', diffErr);
      }
    }
    
    // Approach 3: Use git log to find commits and then get changed files
    if (changedFilePaths.size === 0) {
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (workspaceFolder && repo.exec) {
          console.log(`Executing git log ${baseBranchName}..${currentBranch.name} --name-only --pretty=format:""`);
          
          // Get files that were changed in commits between the branches
          const result = await repo.exec(workspaceFolder, [
            'log', `${baseBranchName}..${currentBranch.name}`, '--name-only', '--pretty=format:""'
          ]);
          
          console.log('Git log command output:', result.stdout);
          
          const fileList = result.stdout.trim().split('\n').filter(line => line.trim() !== '');
          console.log('Files from git log command:', fileList);
          
          for (const file of fileList) {
            if (!shouldSkipFile(file)) {
              changedFilePaths.add(file);
            }
          }
        }
      } catch (logErr) {
        console.error('Error executing git log command:', logErr);
      }
    }
    
    console.log('Final changed file paths:', Array.from(changedFilePaths));
    
    // If no files found after all approaches, show message and return
    if (changedFilePaths.size === 0) {
      // Show a more detailed error message with debugging information
      vscode.window.showInformationMessage(
        `No differences found between ${currentBranch.name} and ${baseBranchName}. ` +
        `This might be due to limitations in how branch differences are detected. ` +
        `Try using the Git CLI directly with: git diff --name-only ${baseBranchName}...${currentBranch.name}`
      );
      
      // Log additional debug information
      console.log('Debug info:');
      console.log(`Current branch: ${currentBranch.name}`);
      console.log(`Base branch: ${baseBranchName}`);
      console.log('All approaches failed to find differences between branches.');
      
      return;
    }
    
    // Create pick items for selection UI
    const filePickItems: FilePickItem[] = [];
    
    for (const filePath of changedFilePaths) {
      if (!shouldSkipFile(filePath)) {
        try {
          // Create URI for the file
          const fileUri = vscode.Uri.file(`${vscode.workspace.workspaceFolders?.[0].uri.fsPath}/${filePath}`);
          
          filePickItems.push({
            label: filePath,
            picked: true, // Selected by default
            uri: fileUri
          });
        } catch (err) {
          // Skip files that can't be processed
          continue;
        }
      }
    }
    
    // Show QuickPick UI with checkboxes
    const selectedFiles = await vscode.window.showQuickPick(filePickItems, {
      canPickMany: true,
      placeHolder: 'Select files to include in the comparison',
      title: `Files changed between ${currentBranch.name} and ${baseBranchName}`
    });
    
    // User cancelled the selection
    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }
    
    // Start building the output content
    let outputContent = `### code review request\nbranch name: ${currentBranch.name}\ncompared with: ${baseBranchName}\n\n`;
    
    // Add original files section
    outputContent += `original:\n\n`;
    
    // Get the workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    
    for (const file of selectedFiles) {
      try {
        // Use Git CLI directly to get file content from master branch
        // This bypasses the VS Code Git API completely
        console.log(`Getting content for ${file.label} using direct git command`);
        
        // Use git show command to get file content from the base branch
        const command = `git -C "${workspaceFolder}" show ${baseBranchName}:${file.label}`;
        console.log(`Executing: ${command}`);
        
        try {
          const { stdout } = await execPromise(command);
          console.log(`Successfully retrieved content for ${file.label} from ${baseBranchName}`);
          outputContent += `${file.label}:\n${stdout}\n\n`;
        } catch (gitShowErr: any) {
          console.error(`Error getting content for ${file.label} using git show:`, gitShowErr);
          
          // Try with repo.show as fallback
          try {
            console.log(`Trying fallback with repo.show for ${file.label}`);
            const originalContent = await repo.show(baseBranchName, file.label);
            outputContent += `${file.label}:\n${originalContent}\n\n`;
          } catch (repoShowErr: any) {
            console.error(`Fallback also failed for ${file.label}:`, repoShowErr);
            
            // If both methods fail, the file might not exist in the base branch
            const errorMessage = gitShowErr.message || 'Unknown error';
            outputContent += `${file.label}:\n[File does not exist in ${baseBranchName} or error occurred: ${errorMessage}]\n\n`;
          }
        }
      } catch (err: any) {
        console.error(`Unexpected error for ${file.label}:`, err);
        outputContent += `${file.label}:\n[Error retrieving content: ${err.message || 'Unknown error'}]\n\n`;
      }
    }
    
    // Add modified files section
    outputContent += `modified:\n\n`;
    
    for (const file of selectedFiles) {
      try {
        // Get current file content
        const doc = await vscode.workspace.openTextDocument(file.uri);
        const info = getDocumentInfo(doc);
        outputContent += `${info.path}:\n${info.content}\n\n`;
      } catch (err) {
        // Skip files that can't be opened
        outputContent += `${file.label}:\n[Unable to read current file content]\n\n`;
      }
    }
    
    await createOutputDocument(outputContent);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to compare branches: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  
  // Register the new command for branch comparison
  const listBranchComparisonCommand = vscode.commands.registerCommand(
    'list-open-files.listBranchComparisonFiles',
    listBranchComparisonFiles
  );

  context.subscriptions.push(
    listOpenFilesCommand, 
    listModifiedFilesCommand,
    listBranchComparisonCommand
  );
};

export const deactivate = (): void => {
  // Nothing to clean up
};
