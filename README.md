# List Open Files Extension

A VS Code extension that lists all currently open files and their contents into a single text document.

## Features

- Lists all open files in the editor
- Shows the relative path of each file
- Displays the content of each file
- Excludes untitled (unsaved) files
- Creates a new document with the consolidated output

## Usage

1. Open the Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux)
2. Type "List All Open Files" and select the command
3. A new document will open showing all files in the format:
```
relative/path/to/file1.ext:
[ file1 contents ]

relative/path/to/file2.ext:
[ file2 contents ]
```

## Requirements

- VS Code version 1.50.0 or higher

## Extension Settings

This extension does not contribute any settings.

## Known Issues

None at this time.

## Release Notes

### 0.0.1

Initial release:
- Basic functionality to list open files and their contents
