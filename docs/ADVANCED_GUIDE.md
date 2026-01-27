# 可用工具列表 (67个)

## 1. 文件系统工具 (filesystem)

### read_file
Read the complete contents of a file as text.

**参数:**
- `path` (必填): string
- `tail` (可选): If provided, returns only the last N lines of the file
- `head` (可选): If provided, returns only the first N lines of the file

### read_text_file
Read the complete contents of a file from the file system as text.

**参数:**
- `path` (必填): string
- `tail` (可选): If provided, returns only the last N lines of the file
- `head` (可选): If provided, returns only the first N lines of the file

### read_media_file
Read an image or audio file.

**参数:**
- `path` (必填): string

### read_multiple_files
Read the contents of multiple files simultaneously.

**参数:**
- `paths` (必填): Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories.

### write_file
Create a new file or completely overwrite an existing file with new content.

**参数:**
- `path` (必填): string
- `content` (必填): string

### edit_file
Make line-based edits to a text file.

**参数:**
- `path` (必填): string
- `edits` (必填): array
- `dryRun` (可选): Preview changes using git-style diff format

### create_directory
Create a new directory or ensure a directory exists.

**参数:**
- `path` (必填): string

### list_directory
Get a detailed listing of all files and directories in a specified path.

**参数:**
- `path` (必填): string

### list_directory_with_sizes
Get a detailed listing of all files and directories in a specified path, including sizes.

**参数:**
- `path` (必填): string
- `sortBy` (可选): Sort entries by name or size

### directory_tree
Get a recursive tree view of files and directories as a JSON structure.

**参数:**
- `path` (必填): string
- `excludePatterns` (可选): array

### move_file
Move or rename files and directories.

**参数:**
- `source` (必填): string
- `destination` (必填): string

### search_files
Recursively search for files and directories matching a pattern.

**参数:**
- `path` (必填): string
- `pattern` (必填): string
- `excludePatterns` (可选): array

### get_file_info
Retrieve detailed metadata about a file or directory.

**参数:**
- `path` (必填): string

### list_allowed_directories
Returns the list of directories that this server is allowed to access.

**参数:**

## 2. 浏览器自动化工具 (chrome-devtools)

### click
Clicks on the provided element.

**参数:**
- `uid` (必填): The uid of an element on the page from the page content snapshot
- `dblClick` (可选): Set to true for double clicks. Default is false.

### close_page
Closes the page by its index.

**参数:**
- `pageId` (必填): The ID of the page to close. Call list_pages to list pages.

### drag
Drag an element onto another element.

**参数:**
- `from_uid` (必填): The uid of the element to drag
- `to_uid` (必填): The uid of the element to drop into

### emulate
Emulates various features on the selected page.

**参数:**
- `networkConditions` (可选): Throttle network. Set to "No emulation" to disable. If omitted, conditions remai
- `cpuThrottlingRate` (可选): Represents the CPU slowdown factor. Set the rate to 1 to disable throttling. If 
- `geolocation` (可选): Geolocation to emulate. Set to null to clear the geolocation override.

### evaluate_script
Evaluate a JavaScript function inside the currently selected page.

**参数:**
- `function` (必填): A JavaScript function declaration to be executed by the tool in the currently se
- `args` (可选): An optional list of arguments to pass to the function.

### fill
Type text into a input, text area or select an option from a <select> element.

**参数:**
- `uid` (必填): The uid of an element on the page from the page content snapshot
- `value` (必填): The value to fill in

### fill_form
Fill out multiple form elements at once.

**参数:**
- `elements` (必填): Elements from snapshot to fill out.

### get_console_message
Gets a console message by its ID.

**参数:**
- `msgid` (必填): The msgid of a console message on the page from the listed console messages

### get_network_request
Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.

**参数:**
- `reqid` (可选): The reqid of the network request. If omitted returns the currently selected requ

### handle_dialog
If a browser dialog was opened, use this command to handle it.

**参数:**
- `action` (必填): Whether to dismiss or accept the dialog
- `promptText` (可选): Optional prompt text to enter into the dialog.

### hover
Hover over the provided element.

**参数:**
- `uid` (必填): The uid of an element on the page from the page content snapshot

### list_console_messages
List all console messages for the currently selected page since the last navigation.

**参数:**
- `pageSize` (可选): Maximum number of messages to return. When omitted, returns all requests.
- `pageIdx` (可选): Page number to return (0-based). When omitted, returns the first page.
- `types` (可选): Filter messages to only return messages of the specified resource types. When om
- `includePreservedMessages` (可选): Set to true to return the preserved messages over the last 3 navigations.

### list_network_requests
List all requests for the currently selected page since the last navigation.

**参数:**
- `pageSize` (可选): Maximum number of requests to return. When omitted, returns all requests.
- `pageIdx` (可选): Page number to return (0-based). When omitted, returns the first page.
- `resourceTypes` (可选): Filter requests to only return requests of the specified resource types. When om
- `includePreservedRequests` (可选): Set to true to return the preserved requests over the last 3 navigations.

### list_pages
Get a list of pages open in the browser.

**参数:**

### navigate_page
Navigates the currently selected page to a URL.

**参数:**
- `type` (可选): Navigate the page by URL, back or forward in history, or reload.
- `url` (可选): Target URL (only type=url)
- `ignoreCache` (可选): Whether to ignore cache on reload.
- `timeout` (可选): Maximum wait time in milliseconds. If set to 0, the default timeout will be used

### new_page
Creates a new page.

**参数:**
- `url` (必填): URL to load in a new page.
- `timeout` (可选): Maximum wait time in milliseconds. If set to 0, the default timeout will be used

### performance_analyze_insight
Provides more detailed information on a specific Performance Insight of an insight set that was highlighted in the results of a trace recording.

**参数:**
- `insightSetId` (必填): The id for the specific insight set. Only use the ids given in the "Available in
- `insightName` (必填): The name of the Insight you want more information on. For example: "DocumentLate

### performance_start_trace
Starts a performance trace recording on the selected page.

**参数:**
- `reload` (必填): Determines if, once tracing has started, the page should be automatically reload
- `autoStop` (必填): Determines if the trace recording should be automatically stopped.
- `filePath` (可选): The absolute file path, or a file path relative to the current working directory

### performance_stop_trace
Stops the active performance trace recording on the selected page.

**参数:**
- `filePath` (可选): The absolute file path, or a file path relative to the current working directory

### press_key
Press a key or key combination.

**参数:**
- `key` (必填): A key or a combination (e.g., "Enter", "Control+A", "Control++", "Control+Shift+

### resize_page
Resizes the selected page's window so that the page has specified dimension.

**参数:**
- `width` (必填): Page width
- `height` (必填): Page height

### select_page
Select a page as a context for future tool calls.

**参数:**
- `pageId` (必填): The ID of the page to select. Call list_pages to get available pages.
- `bringToFront` (可选): Whether to focus the page and bring it to the top.

### take_screenshot
Take a screenshot of the page or element.

**参数:**
- `format` (可选): Type of format to save the screenshot as. Default is "png"
- `quality` (可选): Compression quality for JPEG and WebP formats (0-100). Higher values mean better
- `uid` (可选): The uid of an element on the page from the page content snapshot. If omitted tak
- `fullPage` (可选): If set to true takes a screenshot of the full page instead of the currently visi
- `filePath` (可选): The absolute path, or a path relative to the current working directory, to save 

### take_snapshot
Take a text snapshot of the currently selected page based on the a11y tree.

**参数:**
- `verbose` (可选): Whether to include all possible information available in the full a11y tree. Def
- `filePath` (可选): The absolute path, or a path relative to the current working directory, to save 

### upload_file
Upload a file through a provided element.

**参数:**
- `uid` (必填): The uid of the file input element or an element that will open file chooser on t
- `filePath` (必填): The local path of the file to upload

### wait_for
Wait for the specified text to appear on the selected page.

**参数:**
- `text` (必填): Text to appear on the page
- `timeout` (可选): Maximum wait time in milliseconds. If set to 0, the default timeout will be used

## 3. 命令执行工具 (shell)

### run_command
Run a command on this darwin machine

**参数:**
- `command`: Command with args
- `workdir`: Optional, current working directory
- `stdin`: Optional, text to pipe into the command's STDIN. For example, pass a python script to python3. Or, pass text for a new file to the cat command to create it!

## 4. 代码分析工具 (tree-sitter)

### configure
Configure the server.

### register_project_tool
Register a project directory for code exploration.

### list_projects_tool
List all registered projects.

### remove_project_tool
Remove a registered project.

### list_languages
List available languages.

### check_language_available
Check if a tree-sitter language parser is available.

### list_files
List files in a project.

### get_file
Get content of a file.

### get_file_metadata
Get metadata for a file.

### get_ast
Get abstract syntax tree for a file.

### get_node_at_position
Find the AST node at a specific position.

### find_text
Search for text pattern in project files.

### run_query
Run a tree-sitter query on project files.

### get_query_template_tool
Get a predefined tree-sitter query template.

### list_query_templates_tool
List available query templates.

### build_query
Build a tree-sitter query from templates or patterns.

### adapt_query
Adapt a query from one language to another.

### get_node_types
Get descriptions of common node types for a language.

### get_symbols
Extract symbols from a file.

### analyze_project
Analyze overall project structure.

### get_dependencies
Find dependencies of a file.

### analyze_complexity
Analyze code complexity.

### find_similar_code
Find similar code to a snippet.

### find_usage
Find usage of a symbol.

### clear_cache
Clear the parse tree cache.

### diagnose_config
Diagnose issues with YAML configuration loading.

