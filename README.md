# List Open Files Extension

A VS Code extension that lists all currently open files and their contents into a single text document.

## Features

- Lists all open files in the editor
- Lists all Git modified files (staged or unstaged) with an interactive selection UI
- Compares files between current branch and main/master branch with an interactive selection UI
- Shows the relative path of each file
- Displays the content of each file
- Excludes untitled (unsaved) files
- Creates a new document with the consolidated output

## Usage

1. Open the Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux)
2. Type "List All Open Files" and select the command to list currently open files
   OR
   Type "List All Modified Files" and select the command to list Git modified files
   OR
   Type "Compare Files with Main/Master Branch" to compare files between branches
3. For modified files or branch comparison, a selection UI will appear allowing you to choose which files to include
4. A new document will open showing all files in the format:

For open files and modified files:
```
relative/path/to/file1.ext:
[ file1 contents ]

relative/path/to/file2.ext:
[ file2 contents ]
```

For branch comparison:
```
### code review request
branch name: [current-branch]
compared with: [main/master]

original:

file_name:
[ content from main/master branch ]

file_name:
[ content from main/master branch ]

modified:

file_name:
[ content from current branch ]

file_name:
[ content from current branch ]
```

## Requirements

- VS Code version 1.50.0 or higher

## Extension Settings

This extension does not contribute any settings.

## Known Issues

- **"Unable to determine current branch" error**: This can occur when trying to use the "Compare Files with Main/Master Branch" feature in the following situations:
  - You are in a detached HEAD state
  - The repository doesn't have any commits yet
  - You are not in a Git repository
  - The Git extension is not properly initialized
  
  The extension now includes improved branch detection that attempts to use multiple methods to determine the current branch:
  1. Standard Git API's HEAD property
  2. Git command `git branch --show-current`
  3. Git command `git symbolic-ref --short HEAD`
  4. If all automatic methods fail, the extension will prompt you to enter the branch name manually

## Release Notes

### 0.0.4

- Added "Compare Files with Main/Master Branch" functionality to compare files between branches

### 0.0.3

- Enhanced "List All Modified Files" with an interactive selection UI

### 0.0.2

- Added functionality to list Git modified files (staged or unstaged)

### 0.0.1

Initial release:
- Basic functionality to list open files and their contents
